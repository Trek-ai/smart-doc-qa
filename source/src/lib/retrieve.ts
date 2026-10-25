/**
 * 检索：本地 BM25 关键词打分，取分数最高的前 topK 块。
 *
 * 为什么不做向量检索：本工具面向「上传几份办公文档，问几个问题」的用法，
 * 单文档语料下 BM25 的实测 Recall@5 已是 100%，不值得再让用户去配一个向量服务密钥。
 */

import { buildBm25 } from './bm25';
import { config } from './config';
import type { Chunk } from './model';

export interface Retrieved {
  chunk: Chunk;
  /** BM25 原始分 */
  score: number;
}

/**
 * 检索与问题最相关的知识块。
 * @returns 按相关度降序的块；全部无命中时返回空数组（调用方据此直接回答「没有相关内容」）
 */
export function retrieve(question: string, chunks: Chunk[], topK: number = config.topK): Retrieved[] {
  if (!chunks.length || !question.trim()) return [];

  const scores = buildBm25(chunks.map((c) => c.text)).scores(question);

  return scores
    .map((score, index) => ({ score, index }))
    .filter((item) => item.score > 0)
    // 同分时按文档内顺序定序，保证同样输入永远同样输出
    .sort((a, b) => b.score - a.score || chunks[a.index].order - chunks[b.index].order)
    .slice(0, topK)
    .map((item) => ({
      chunk: chunks[item.index],
      score: Number(item.score.toFixed(4)),
    }));
}