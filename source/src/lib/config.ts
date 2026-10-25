/**
 * 服务端运行时配置。
 * 生成模型使用公开的免密钥 OpenAI 兼容接口——整套系统不需要任何密钥；
 * 检索用本地 BM25，不需要向量服务，也不需要数据库。
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
  /**
   * 生成模型通道：公开免密钥接口。
   * 如需换成其他 OpenAI 兼容端点（自建、内网、其他服务商），改 FREE_BASE_URL / FREE_MODEL 即可。
   */
  llm: {
    baseUrl: stripSlash(env('FREE_BASE_URL', 'https://text.pollinations.ai/openai')),
    model: env('FREE_MODEL', 'openai'),
  },
  /** 检索送入模型的块数 */
  topK: 6,
  /** 单文件上传上限 */
  maxUploadBytes: 20 * 1024 * 1024,
  /** 索引落盘目录；重启后从这里恢复 */
  dataDir: env('DATA_DIR') || path.join(process.cwd(), '.data'),
  /** 单次生成的整体超时；免密钥接口首字较慢，留足余量 */
  requestTimeoutMs: 120_000,
} as const;

/** 当前使用的模型名，供界面展示 */
export function activeModel(): string {
  return config.llm.model;
}
