/**
 * 生成模型客户端：公开免密钥的 OpenAI 兼容接口，流式问答。
 * 不需要密钥；调用带整体超时、错误包装与外部中断支持。
 */

import { config } from './config';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  text: string;
}

interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  /** 外部中断信号，用户点「停止生成」时触发 */
  signal?: AbortSignal;
}

/**
 * 流式生成。
 * @yields 增量文本
 * @throws Error 接口不可用或超时
 */
export async function* streamChat(
  turns: ChatTurn[],
  options: StreamOptions = {},
): AsyncGenerator<StreamChunk> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.llm.model,
        messages: turns,
        stream: true,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 4096,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      // 免费接口的限流提示原样带出，便于界面给出可读解释
      throw new Error(`模型服务返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) yield { text: delta };
        } catch {
          // 单行解析失败不影响整体输出
        }
      }
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
