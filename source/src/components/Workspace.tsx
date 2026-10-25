'use client';

/**
 * 单页工作台：左边传文件、右边问问题。
 * 只做一件事——根据你上传的文档回答问题，并在回答里给出可点回原文的页码引用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatMessage, Citation, Doc } from '@/lib/api';
import { queryKeywords } from '@/lib/bm25';
import { deleteDoc, fetchStatus, streamAnswer, uploadFile, type StatusResponse } from '@/lib/client/api';
import { formatBytes } from '@/lib/client/format';
import {
  IconClose,
  IconQuote,
  IconSend,
  IconSpinner,
  IconStop,
  IconTrash,
  IconUpload,
} from '@/lib/client/icons';
import { highlightTerms, renderAnswer } from '@/lib/client/render';

/**
 * 解析本次提问的文档范围。
 * 支持两种指定方式：提问文本里写 @编号（如「@1 @3 这两份材料有没有冲突」），
 * 或左侧列表点选/多选；两者同时存在时以 @编号 为准，都没有则默认全部文档。
 * @returns docIds 命中的文档 id、scopeNumbers 命中的编号、cleanText 去掉 @编号 后的问题
 */
function resolveScope(text: string, docs: Doc[], selectedIds: string[]) {
  const numbers = [...text.matchAll(/@(\d+)/g)].map((match) => Number(match[1]));
  const picked = numbers.map((num) => docs[num - 1]).filter((doc): doc is Doc => Boolean(doc));

  const ids = picked.length ? picked.map((doc) => doc.id) : selectedIds;
  const effective = ids.length ? ids : docs.map((doc) => doc.id);
  const scopeNumbers = effective
    .map((id) => docs.findIndex((doc) => doc.id === id) + 1)
    .filter((num) => num > 0);

  const cleanText = text.replace(/@\d+/g, '').replace(/\s{2,}/g, ' ').trim();
  return { docIds: effective, scopeNumbers, cleanText: cleanText || text };
}

/** 没有文档时展示的引导问题，纯通用句式，不预设任何文档内容 */
const STARTERS = ['这份文档主要讲了什么？', '有哪些要求或注意事项？', '把关键数据列出来'];

interface Uploading {
  name: string;
  percent: number;
}

interface ActiveCitation {
  citation: Citation;
  /** 产生这条引用的问题，用于高亮命中词 */
  question: string;
}

export function Workspace() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [active, setActive] = useState<ActiveCitation | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const docs = status?.docs ?? [];
  /** 本次提问选中的文档 id；为空表示对全部文档提问 */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages]);

  /** 逐个上传：一次失败不影响其余文件，错误集中提示 */
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setErrors([]);
      setUploading(files.map((file) => ({ name: file.name, percent: 0 })));

      const failed: string[] = [];
      for (const file of files) {
        try {
          await uploadFile(file, (percent) =>
            setUploading((prev) => prev.map((item) => (item.name === file.name ? { ...item, percent } : item))),
          );
        } catch (error) {
          failed.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          setUploading((prev) => prev.filter((item) => item.name !== file.name));
        }
      }

      if (failed.length) setErrors(failed);
      if (fileInput.current) fileInput.current.value = '';
      await refresh();
    },
    [refresh],
  );

  const pickCitation = useCallback(
    (message: ChatMessage, index: number) => {
      const citation = message.citations?.find((item) => item.index === index);
      if (citation) setActive({ citation, question: message.question ?? '' });
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** 发送提问：先落两条消息，再随 SSE 增量填充回答 */
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;

      const history = messages
        .filter((message) => !message.error && message.content.trim())
        .slice(-6)
        .map((message) => ({ role: message.role, content: message.content }));

      const { docIds, scopeNumbers, cleanText } = resolveScope(text, docs, selectedIds);

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: cleanText, scope: scopeNumbers, createdAt: Date.now() },
        { id: assistantId, role: 'assistant', content: '', question: cleanText, createdAt: Date.now() },
      ]);
      setQuestion('');
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (update: (message: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((message) => (message.id === assistantId ? update(message) : message)));

      try {
        await streamAnswer(
          { question: cleanText, docIds, history },
          {
            onCitations: (items) => patch((message) => ({ ...message, citations: items })),
            onToken: (chunk) => patch((message) => ({ ...message, content: message.content + chunk })),
            onError: (message) => patch((item) => ({ ...item, error: message })),
          },
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) {
          patch((message) => ({ ...message, error: '已停止生成。' }));
        } else {
          patch((message) => ({ ...message, error: error instanceof Error ? error.message : String(error) }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, docs, messages, selectedIds],
  );

  /** 点文档=只看这份；按住 Ctrl/⌘ 点击=加入或移出多选 */
  const toggleDoc = useCallback((id: string, multi: boolean) => {
    setSelectedIds((prev) => {
      if (!multi) return prev.length === 1 && prev[0] === id ? [] : [id];
      return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
    });
  }, []);

  const remove = useCallback(
    async (doc: Doc) => {
      try {
        await deleteDoc(doc.id);
      } catch (error) {
        setErrors([error instanceof Error ? error.message : String(error)]);
      }
      await refresh();
    },
    [refresh],
  );

  const keywords = useMemo(() => (active ? queryKeywords(active.question) : []), [active]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-ink">文档问答</h1>
          <p className="text-xs text-ink-faint">上传 Word / PDF / 文本，提问后每条结论都能点回原文页码</p>
        </div>
        <div className="text-xs text-ink-soft">
          {status
            ? `${status.docs.length} 份文档 · ${status.stats.chunks} 个片段 · 模型 ${status.model}（免费免密钥）`
            : '正在读取…'}
        </div>
      </header>

      {errors.length ? (
        <div className="flex items-start gap-3 border-b border-line bg-red-50 px-5 py-2 text-xs text-danger">
          <ul className="flex-1 space-y-1">
            {errors.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setErrors([])} className="shrink-0 hover:opacity-70">
            <IconClose className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[300px_1fr]">
        {/* 左：上传与文档列表 */}
        <aside className="min-h-0 overflow-y-auto border-b border-line bg-surface/60 p-4 md:border-b-0 md:border-r">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void handleFiles(Array.from(event.dataTransfer.files));
            }}
            className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center text-sm transition ${
              dragging ? 'border-brand bg-brand-wash text-brand-deep' : 'border-line-strong text-ink-soft hover:border-brand'
            }`}
          >
            <IconUpload className="h-5 w-5" />
            <span>点这里选文件，或把文件拖进来</span>
            <span className="text-xs text-ink-faint">支持 PDF / Word（.docx、.doc）/ 文本，单文件 20MB 以内</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.md,.markdown"
            className="hidden"
            onChange={(event) => void handleFiles(Array.from(event.target.files ?? []))}
          />

          {uploading.map((item) => (
            <div key={item.name} className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
              <IconSpinner className="h-3.5 w-3.5 animate-spin" />
              <span className="flex-1 truncate">{item.name}</span>
              <span>{item.percent}%</span>
            </div>
          ))}

          <div className="mt-5 space-y-2">
            {docs.length ? (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${
                    selectedIds.length === 0
                      ? 'border-brand bg-brand-wash text-brand-deep'
                      : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                  }`}
                >
                  <span>全部文档</span>
                  <span>{docs.length} 份</span>
                </button>
                <p className="px-1 text-[11px] leading-5 text-ink-faint">
                  点文档=只看这一份；Ctrl / ⌘ + 点击=多选；也可在提问里写 @编号
                </p>
              </>
            ) : null}
            {docs.map((doc, index) => {
              const selected = selectedSet.has(doc.id);
              return (
                <div
                  key={doc.id}
                  onClick={(event) => toggleDoc(doc.id, event.ctrlKey || event.metaKey)}
                  title="点击：只看这一份；Ctrl/⌘+点击：多选"
                  className={`group flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition ${
                    selected ? 'border-brand bg-brand-wash' : 'border-line bg-surface hover:border-line-strong'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-medium ${
                      selected ? 'bg-brand text-white' : 'bg-line text-ink-soft'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm text-ink" title={doc.name}>
                      {doc.name}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {doc.pages} 页 · {doc.chunks} 片段 · {formatBytes(doc.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void remove(doc);
                    }}
                    title="删除这份文档"
                    className="shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-danger"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {!docs.length && !uploading.length ? (
              <p className="px-1 text-xs text-ink-faint">还没有文档。上传后这里会列出文件名与页数。</p>
            ) : null}
          </div>
        </aside>

        {/* 右：问答 */}
        <section className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {!messages.length ? (
              <div className="mx-auto mt-10 max-w-md text-center">
                <IconQuote className="mx-auto h-6 w-6 text-ink-faint" />
                <p className="mt-3 text-sm text-ink-soft">
                  上传文档后直接提问，不用自己翻页。回答里的每个结论都会标出出处，点角标就能看原文。
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      disabled={!docs.length}
                      onClick={() => void send(starter)}
                      className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft transition enabled:hover:border-brand enabled:hover:text-brand-deep disabled:opacity-40"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="ml-auto max-w-[85%]">
                  {message.scope?.length ? (
                    <p className="mb-1 text-right text-[11px] text-ink-faint">
                      提问范围 {message.scope.map((num) => `#${num}`).join(' ')}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap rounded-2xl bg-brand px-4 py-2.5 text-sm text-white">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div key={message.id} className="max-w-[90%] rounded-2xl border border-line bg-surface px-4 py-3">
                  <div className="whitespace-pre-wrap text-[15px] leading-7 text-ink">
                    {message.content
                      ? renderAnswer(message.content, message.citations ?? [], (index) => pickCitation(message, index))
                      : busy
                        ? '正在检索并生成…'
                        : ''}
                  </div>
                  {message.error ? <p className="mt-2 text-xs text-danger">{message.error}</p> : null}
                  {message.citations?.length ? (
                    <p className="mt-2 border-t border-line pt-2 text-xs text-ink-faint">
                      引用 {message.citations.length} 处，点角标看原文
                    </p>
                  ) : null}
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>

          <form
            className="border-t border-line bg-surface px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send(question);
            }}
          >
            {docs.length ? (
              <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
                <span>提问范围：</span>
                {selectedIds.length ? (
                  docs
                    .filter((doc) => selectedSet.has(doc.id))
                    .map((doc) => (
                      <span
                        key={doc.id}
                        className="max-w-[190px] truncate rounded bg-brand-wash px-1.5 py-0.5 text-brand-deep"
                        title={doc.name}
                      >
                        #{docs.indexOf(doc) + 1} {doc.name}
                      </span>
                    ))
                ) : (
                  <span className="text-ink-faint">全部 {docs.length} 份</span>
                )}
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send(question);
                  }
                }}
                rows={2}
                placeholder={
                  docs.length
                    ? '就上传的文档提问，Enter 发送；可用 @1 @3 指定范围'
                    : '先上传一份文档'
                }
                className="max-h-40 min-h-[52px] flex-1 resize-y rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={stop}
                  className="flex h-11 items-center gap-1.5 rounded-xl border border-line px-3 text-sm text-ink-soft transition hover:border-danger hover:text-danger"
                >
                  <IconStop className="h-4 w-4" /> 停止
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!question.trim()}
                  className="flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm text-white transition enabled:hover:bg-brand-deep disabled:opacity-40"
                >
                  <IconSend className="h-4 w-4" /> 提问
                </button>
              )}
            </div>
          </form>
        </section>
      </main>

      {/* 引用原文抽屉 */}
      {active ? (
        <div className="fixed inset-0 z-20 flex justify-end bg-ink/20" onClick={() => setActive(null)}>
          <div
            className="flex h-full w-full max-w-md animate-slide-in flex-col border-l border-line bg-surface"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{active.citation.docName}</p>
                <p className="text-xs text-ink-faint">
                  第 {active.citation.page} 页 · 引用 [{active.citation.index}]
                  {active.question ? ` · 提问「${active.question}」` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setActive(null)} className="shrink-0 text-ink-faint hover:text-ink">
                <IconClose className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm leading-7 text-ink-soft">
              {highlightTerms(active.citation.text, keywords)}
            </div>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="border-t border-line bg-red-50 px-5 py-2 text-xs text-danger">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="ml-2 underline">
            知道了
          </button>
        </p>
      ) : null}
    </div>
  );
}