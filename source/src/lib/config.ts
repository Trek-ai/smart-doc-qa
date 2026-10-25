/**
 * 服务端运行时配置。密钥只从环境变量读取，不落库不硬编码。
 * 本工具只依赖一个生成模型密钥，检索用本地 BM25，不需要向量服务。
 */

import path from 'node:path';

function env(key: string, fallback = ''): string {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const config = {
  deepseek: {
    apiKey: env('DEEPSEEK_API_KEY'),
    baseUrl: stripSlash(env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')),
    model: env('DEEPSEEK_MODEL', 'deepseek-chat'),
  },
  /** 检索送入模型的块数 */
  topK: 6,
  /** 单文件上传上限 */
  maxUploadBytes: 20 * 1024 * 1024,
  /** 索引落盘目录；重启后从这里恢复 */
  dataDir: env('DATA_DIR') || path.join(process.cwd(), '.data'),
  requestTimeoutMs: 60_000,
} as const;

/** 生成模型是否可用 */
export function hasChatKey(): boolean {
  return Boolean(config.deepseek.apiKey);
}

export const llmOptions = {
  /**
   * 流式问答是否关闭思考，默认保留。
   *
   * 背景：deepseek-v4.1-flash 这类推理模型会先产生思维链，答案质量更好，
   * 但首字延迟更高。想更快就把 LLM_CHAT_THINKING 设成 off。
   */
  chatWithoutThinking: env('LLM_CHAT_THINKING', 'on').toLowerCase() === 'off',
};