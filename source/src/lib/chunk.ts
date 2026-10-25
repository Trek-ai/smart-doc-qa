/**
 * 递归文本切分。
 * 职责：把纯文本切成带重叠的语义块，供向量化与检索使用。
 * 策略：段落 -> 句子 -> 硬切，逐级降级，保证任何输入都能切出结果。
 */

export interface ChunkOptions {
  /** 目标块长度（字符数） */
  target: number;
  /** 相邻块的重叠长度（字符数） */
  overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { target: 700, overlap: 120 };

/** 归一化：统一换行、压掉多余空白，保留段落结构 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 按句末标点切句，保留标点 */
function splitSentences(paragraph: string): string[] {
  const parts = paragraph.split(/(?<=[。！？；!?;])/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** 单句仍然超长时按固定长度硬切 */
function hardSplit(text: string, target: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += target) {
    out.push(text.slice(i, i + target));
  }
  return out;
}

/** 把段落拆成不超过 target 的单元 */
function toUnits(paragraph: string, target: number): string[] {
  if (paragraph.length <= target) return [paragraph];
  const units: string[] = [];
  for (const sentence of splitSentences(paragraph)) {
    if (sentence.length <= target) units.push(sentence);
    else units.push(...hardSplit(sentence, target));
  }
  return units.length ? units : hardSplit(paragraph, target);
}

/** 贪心装箱：尽量填满每一块 */
function pack(units: string[], target: number): string[] {
  const chunks: string[] = [];
  let buffer = '';
  for (const unit of units) {
    if (buffer && buffer.length + unit.length > target) {
      chunks.push(buffer);
      buffer = unit;
    } else {
      buffer = buffer ? `${buffer}\n${unit}` : unit;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

/** 给相邻块加重叠，避免答案落在切口上 */
function withOverlap(chunks: string[], overlap: number): string[] {
  if (overlap <= 0) return chunks;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prev = chunks[i - 1];
    const tail = prev.slice(Math.max(0, prev.length - overlap));
    return `${tail}\n${chunk}`;
  });
}

/**
 * 切分入口。
 * @param text 归一化前的原文
 * @returns 语义块数组，空输入返回空数组
 */
export function splitText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const units = paragraphs.flatMap((p) => toUnits(p, options.target));
  if (!units.length) return [];

  return withOverlap(pack(units, options.target), options.overlap).filter((c) => c.trim().length > 0);
}