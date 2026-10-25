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

/** 自有密钥（可留空，留空则走免费模式） */
const deepseekKey = env('DEEPSEEK_API_KEY');

/**
 * 生成服务商。
 * - deepseek：用自有密钥，质量更稳（按量计费）
 * - free：公开免密钥接口，零成本（有频率限制）
 * 默认策略：配了密钥走 deepseek，没配密钥自动走 free；也可用 LLM_PROVIDER 强制指定。
 */
const provider = env('LLM_PROVIDER', deepseekKey ? 'deepseek' : 'free').toLowerCase() === 'deepseek' ? 'deepseek' : 'free';

export const config = {
  provider,
  deepseek: {
    apiKey: deepseekKey,
    baseUrl: stripSlash(env('DEEPSEEK_BASE_URL', 'https://api.deepseek.com')),
    // 按需求锁定：只走 chat 模型（不接受页面或环境覆盖成别的模型）
    model: 'deepseek-chat',
  },
  /** 免费模式：公开的 OpenAI 兼容文本接口，无需密钥 */
  free: {
    baseUrl: stripSlash(env('FREE_BASE_URL', 'https://text.pollinations.ai/openai')),
    model: env('FREE_MODEL', 'openai'),
  },
  /** 检索送入模型的块数 */
  topK: 6,
  /** 单文件上传上限 */
  maxUploadBytes: 20 * 1024 * 1024,
  /** 索引落盘目录；重启后从这里恢复 */
  dataDir: env('DATA_DIR') || path.join(process.cwd(), '.data'),
  requestTimeoutMs: 60_000,
} as const;

/** 是否配置了自有密钥（免费模式下为 false，但生成仍可用） */
export function hasChatKey(): boolean {
  return Boolean(config.deepseek.apiKey);
}

/** 当前实际使用的模型名，供界面展示 */
export function activeModel(): string {
  return config.provider === 'free' ? config.free.model : config.deepseek.model;
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