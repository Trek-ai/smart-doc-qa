/**
 * 问答接口（SSE 流式）。
 * 流程：BM25 检索 -> 先推引用事件 -> 再逐字推回答。
 * 检索无命中时不调用模型，直接给出固定回复，避免编造。
 */

import type { ChatMessage, Citation, SSEEvent } from '@/lib/api';
import { streamChat, type ChatTurn } from '@/lib/llm';
import { buildContextBlock, buildQaUserPrompt, NO_CONTEXT_ANSWER, QA_SYSTEM_PROMPT } from '@/lib/prompts';
import { retrieve } from '@/lib/retrieve';
import { getStore } from '@/lib/store';
import { createCitationFilter } from '@/lib/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 带上下文追问时最多回带的历史条数 */
const HISTORY_LIMIT = 6;

interface ChatBody {
  question?: string;
  docIds?: string[];
  history?: Pick<ChatMessage, 'role' | 'content'>[];
}

const encoder = new TextEncoder();

function sse(event: SSEEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法 JSON。' }), { status: 400 });
  }

  const question = (body.question ?? '').trim();
  if (!question) {
    return new Response(JSON.stringify({ error: '问题不能为空。' }), { status: 400 });
  }

  const docIds = Array.isArray(body.docIds) ? body.docIds : [];
  const chunks = await getStore().chunksOf(docIds);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SSEEvent) => controller.enqueue(sse(event));

      try {
        if (!chunks.length) {
          send({ type: 'token', text: '当前没有可用文档。请先上传 PDF、Word 或文本文件，再开始提问。' });
          send({ type: 'done' });
          return;
        }

        const hits = retrieve(question, chunks);
        if (!hits.length) {
          send({ type: 'token', text: NO_CONTEXT_ANSWER });
          send({ type: 'done' });
          return;
        }

        const citations: Citation[] = hits.map((hit, i) => ({
          index: i + 1,
          docId: hit.chunk.docId,
          docName: hit.chunk.docName,
          page: hit.chunk.page,
          text: hit.chunk.text,
          score: hit.score,
        }));
        send({ type: 'citations', items: citations });

        const history = (body.history ?? [])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(-HISTORY_LIMIT)
          .map<ChatTurn>((m) => ({ role: m.role, content: String(m.content ?? '').slice(0, 2000) }));

        const turns: ChatTurn[] = [
          { role: 'system', content: QA_SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: buildQaUserPrompt(question, buildContextBlock(hits.map((hit) => hit.chunk))) },
        ];

        const filter = createCitationFilter(citations.length);

        for await (const chunk of streamChat(turns, { signal: request.signal })) {
          const safe = filter.push(chunk.text);
          if (safe) send({ type: 'token', text: safe });
        }

        // 缓冲里可能还压着一个没拼完的编号，收尾时补齐
        const tail = filter.flush();
        if (tail) send({ type: 'token', text: tail });

        send({ type: 'done' });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}