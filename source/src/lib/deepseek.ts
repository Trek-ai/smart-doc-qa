/**
 * DeepSeek 客户端：流式问答。
 * 密钥只从环境变量读取；调用带超时、错误包装与外部中断支持。
 */

import { config, llmOptions } from './config';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  text: string;
}

export class MissingKeyError extends Error {
  readonly code = 'NO_KEY';
  constructor() {
    super('还没有配置 DEEPSEEK_API_KEY，请在 source/.env.local 里填好再试。');
    this.name = 'MissingKeyError';
  }
}

function ensureKey(): string {
  if (!config.deepseek.apiKey) throw new MissingKeyError();
  return config.deepseek.apiKey;
}

interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  /** 外部中断信号，用户点「停止生成」时触发 */
  signal?: AbortSignal;
  /** 请求级覆盖（页面里填的密钥/地址/模型）；缺省时退回环境变量 */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * 流式生成。
 * @yields 增量文本
 * @throws MissingKeyError / Error
 */
export async function* streamChat(
  turns: ChatTurn[],
  options: StreamOptions = {},
): AsyncGenerator<StreamChunk> {
  // 免费模式只在「既没有请求级密钥、也没有自有密钥」时生效
  const useFree = !options.apiKey?.trim() && !config.deepseek.apiKey && config.provider === 'free';
  const apiKey = options.apiKey?.trim() || config.deepseek.apiKey;
  if (!apiKey && !useFree) throw new MissingKeyError();
  const baseUrl = useFree
    ? config.free.baseUrl
    : (options.baseUrl?.trim() || config.deepseek.baseUrl).replace(/\/+$/, '');
  const model = useFree ? config.free.model : config.deepseek.model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 免费接口不需要密钥，就不带 Authorization
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: turns,
        stream: true,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 4096,
        // 部分兼容接口不认识 reasoning_effort，只有显式要求关闭思考时才带上
        ...(llmOptions.chatWithoutThinking ? { reasoning_effort: 'none' } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
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