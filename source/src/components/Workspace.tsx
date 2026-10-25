'use client';

/**
 * 单页工作台：左边传文件、右边问问题。
 * 只做一件事——根据你上传的文档回答问题，并在回答里给出可点回原文的页码引用。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatMessage, Citation, Doc } from '@/lib/api';
import { queryKeywords } from '@/lib/bm25';
import {
  clearLocalConfig,
  DEFAULT_LOCAL_CONFIG,
  deleteDoc,
  fetchStatus,
  loadLocalConfig,
  saveLocalConfig,
  streamAnswer,
  uploadFile,
  type LocalConfig,
  type StatusResponse,
} from '@/lib/client/api';
import { formatBytes } from '@/lib/client/format';
import {
  IconClose,
  IconFile,
  IconGear,
  IconQuote,
  IconSend,
  IconSpinner,
  IconStop,
  IconTrash,
  IconUpload,
} from '@/lib/client/icons';
import { highlightTerms, renderAnswer } from '@/lib/client/render';

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

  /** 页面里填的密钥/地址（localStorage），优先于服务端环境变量 */
  const [localCfg, setLocalCfg] = useState<LocalConfig>(loadLocalConfig);
  const [cfgOpen, setCfgOpen] = useState(false);

  const docs = status?.docs ?? [];
  // 免费模式下无需任何密钥即可生成
  const hasUsableKey =
    status?.provider === 'free' || Boolean(status?.hasChatKey) || Boolean(localCfg.apiKey.trim());

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

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: text, createdAt: Date.now() },
        { id: assistantId, role: 'assistant', content: '', question: text, createdAt: Date.now() },
      ]);
      setQuestion('');
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patch = (update: (message: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((message) => (message.id === assistantId ? update(message) : message)));

      try {
        await streamAnswer(
          { question: text, docIds: docs.map((doc) => doc.id), history },
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
    [busy, docs, messages],
  );

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
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <span>
            {status
              ? `${status.docs.length} 份文档 · ${status.stats.chunks} 个片段 · 模型 ${status.model}${status.provider === 'free' ? '（免费）' : ''}`
              : '正在读取…'}
          </span>
          <button
            type="button"
            onClick={() => setCfgOpen(true)}
            title="配置 API 密钥"
            className="rounded p-1 text-ink-faint transition hover:bg-brand-wash hover:text-brand-deep"
          >
            <IconGear className="h-4 w-4" />
          </button>
        </div>
      </header>

      {status && !hasUsableKey ? (
        <p className="flex flex-wrap items-center gap-x-2 border-b border-line bg-amber-50 px-5 py-2 text-xs text-warn">
          <span>还没配置密钥：上传和检索可用，但不会生成回答。</span>
          <button type="button" onClick={() => setCfgOpen(true)} className="underline hover:opacity-70">
            点这里填入 DeepSeek API Key
          </button>
        </p>
      ) : null}

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
            {docs.map((doc) => (
              <div key={doc.id} className="group flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                <IconFile className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink" title={doc.name}>
                    {doc.name}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {doc.pages} 页 · {doc.chunks} 片段 · {formatBytes(doc.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(doc)}
                  title="删除这份文档"
                  className="shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100 hover:text-danger"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </div>
            ))}
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
                <p
                  key={message.id}
                  className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-brand px-4 py-2.5 text-sm text-white"
                >
                  {message.content}
                </p>
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
                placeholder={docs.length ? '就上传的文档提问，Enter 发送，Shift+Enter 换行' : '先上传一份文档'}
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

      {/* 密钥设置弹窗 */}
      {cfgOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/20 p-4" onClick={() => setCfgOpen(false)}>
          <div
            className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">API 设置</p>
                <p className="mt-1 text-xs text-ink-faint">
                  留空即使用内置免费模型（无需密钥）；填自己的密钥则改用 DeepSeek，仅保存在本浏览器。
                </p>
              </div>
              <button type="button" onClick={() => setCfgOpen(false)} className="shrink-0 text-ink-faint hover:text-ink">
                <IconClose className="h-4 w-4" />
              </button>
            </div>
            <label className="mt-4 block text-xs text-ink-soft">
              API Key（必填）
              <input
                type="password"
                value={localCfg.apiKey}
                onChange={(event) => setLocalCfg((prev) => ({ ...prev, apiKey: event.target.value }))}
                placeholder="留空即使用内置评审密钥"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
            <label className="mt-3 block text-xs text-ink-soft">
              API 地址（默认 DeepSeek 官方，任何 OpenAI 兼容接口都可改）
              <input
                type="text"
                value={localCfg.baseUrl}
                onChange={(event) => setLocalCfg((prev) => ({ ...prev, baseUrl: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  clearLocalConfig();
                  setLocalCfg({ ...DEFAULT_LOCAL_CONFIG });
                }}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft transition hover:border-danger hover:text-danger"
              >
                清空
              </button>
              <button
                type="button"
                onClick={() => {
                  saveLocalConfig(localCfg);
                  setCfgOpen(false);
                }}
                className="rounded-lg bg-brand px-4 py-1.5 text-xs text-white transition hover:bg-brand-deep"
              >
                保存
              </button>
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