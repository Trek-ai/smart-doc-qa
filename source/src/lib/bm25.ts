/**
 * 本地 BM25 检索，零网络零密钥。
 * 中文按单字 + 相邻二元组切词，英文数字按整词切，够用且不需要分词词典。
 */

const K1 = 1.5;
const B = 0.75;

/** 中英混排分词：英文数字取整词，中文取单字 + 相邻二元组 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  for (const word of lower.match(/[a-z0-9_]+/g) ?? []) tokens.push(word);

  for (const seg of lower.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (seg.length === 1) {
      tokens.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length; i += 1) {
      tokens.push(seg[i]);
      if (i + 1 < seg.length) tokens.push(seg.slice(i, i + 2));
    }
  }

  return tokens;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

export interface Bm25Index {
  /** 全部文档的得分，顺序与传入 docs 一致 */
  scores(query: string): number[];
}

/** 基于一批文本构建 BM25 索引 */
export function buildBm25(docs: string[]): Bm25Index {
  const docTokens = docs.map(tokenize);
  const docTf = docTokens.map(termFrequency);
  const docLen = docTokens.map((t) => t.length);
  const avgdl = docLen.length ? docLen.reduce((a, b) => a + b, 0) / docLen.length : 0;

  const df = new Map<string, number>();
  for (const tf of docTf) {
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const total = docs.length;

  return {
    scores(query: string): number[] {
      const queryTerms = Array.from(new Set(tokenize(query)));
      const result = new Array<number>(total).fill(0);

      for (const term of queryTerms) {
        const dfCount = df.get(term);
        if (!dfCount) continue;
        const idf = Math.log(1 + (total - dfCount + 0.5) / (dfCount + 0.5));

        for (let i = 0; i < total; i += 1) {
          const tf = docTf[i].get(term);
          if (!tf) continue;
          const norm = avgdl > 0 ? docLen[i] / avgdl : 1;
          result[i] += idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + B * norm)));
        }
      }

      return result;
    },
  };
}

/** 供前端高亮使用的命中词（长度 ≥2 的词与二元组） */
export function queryKeywords(query: string): string[] {
  return Array.from(new Set(tokenize(query).filter((t) => t.length >= 2))).slice(0, 24);
}