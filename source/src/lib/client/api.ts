/**
 * 浏览器侧的接口调用封装。
 * 所有网络错误都翻译成中文提示，调用方只需要展示 message。
 */

import type { ApiError, ChatMessage, Citation, Doc, SSEEvent } from '@/lib/api';

export interface StatusResponse {
  docs: Doc[];
  stats: { docs: number; chunks: number };
  hasChatKey: boolean;
  model: string;
  /** 服务端实际生效的单文件上传上限 */
  uploadLimitBytes?: number;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as ApiError;
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchStatus(): Promise<StatusResponse> {
  const response = await fetch('/api/docs', { cache: 'no-store' });
  if (!response.ok) throw new Error(await readError(response, '读取文档列表失败'));
  return (await response.json()) as StatusResponse;
}

export interface IngestResponse {
  doc: Doc;
  stats: { docs: number; chunks: number };
}

/** 用 XHR 上传，换取真实进度回调 */
export function uploadFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<IngestResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/ingest');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText) as IngestResponse & ApiError;
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
        else reject(new Error(payload?.error || `上传失败（${xhr.status}）`));
      } catch {
        reject(new Error(`上传失败（${xhr.status}）`));
      }
    };

    xhr.onerror = () => reject(new Error('网络中断，上传没有完成。'));
    xhr.ontimeout = () => reject(new Error('上传超时，请重试。'));
    xhr.timeout = 5 * 60 * 1000;
    xhr.send(form);
  });
}

export async function deleteDoc(id: string): Promise<void> {
  const response = await fetch(`/api/docs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  // 服务端可能已经因为重启而丢掉这份文档；这种情况按删除成功处理，界面不必报错。
  if (response.status === 404) return;
  if (!response.ok) throw new Error(await readError(response, '删除失败'));
}

export interface LocalConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const LS_KEY = 'docqa.local-config';

export const DEFAULT_LOCAL_CONFIG: LocalConfig = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
};

/** 读取页面里填的密钥/地址；只存浏览器 localStorage，随请求发送，不落服务端 */
export function loadLocalConfig(): LocalConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_LOCAL_CONFIG };
    return { ...DEFAULT_LOCAL_CONFIG, ...(JSON.parse(raw) as Partial<LocalConfig>) };
  } catch {
    return { ...DEFAULT_LOCAL_CONFIG };
  }
}

export function saveLocalConfig(cfg: LocalConfig): void {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
}

export function clearLocalConfig(): void {
  localStorage.removeItem(LS_KEY);
}

export interface ChatRequest {
  question: string;
  docIds: string[];
  history: Pick<ChatMessage, 'role' | 'content'>[];
}

export interface ChatHandlers {
  /** 本次回答命中的原文片段，编号与正文 [n] 角标一一对应 */
  onCitations?: (items: Citation[]) => void;
  onToken?: (text: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

/** 发起流式问答；出错时通过 onError 上报，不抛异常 */
export async function streamAnswer(
  body: ChatRequest,
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const cfg = loadLocalConfig();
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { 'x-ds-key': cfg.apiKey } : {}),
      ...(cfg.baseUrl ? { 'x-ds-base-url': cfg.baseUrl } : {}),
      ...(cfg.model ? { 'x-ds-model': cfg.model } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    handlers.onError?.(await readError(response, `请求失败（${response.status}）`));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const line = block.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;

      let event: SSEEvent;
      try {
        event = JSON.parse(line.slice(5).trim()) as SSEEvent;
      } catch {
        continue;
      }

      if (event.type === 'token') handlers.onToken?.(event.text);
      else if (event.type === 'citations') handlers.onCitations?.(event.items);
      else if (event.type === 'done') handlers.onDone?.();
      else if (event.type === 'error') handlers.onError?.(event.message);
    }
  }
}