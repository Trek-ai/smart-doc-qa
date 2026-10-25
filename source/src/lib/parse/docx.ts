/**
 * Word（.docx）解析：自研 OOXML 全量提取为主，mammoth 兜底。
 *
 * 覆盖范围见 ooxml.ts：正文段落、表格、文本框、页眉页脚、脚注尾注、批注，
 * 并按文档里的分页标记还原页码。
 *
 * 注意：进到这里的前提是「内容确实是 .docx 包」。旧版 .doc、加密文档、
 * 改了后缀的 RTF / PDF 都在 parse/index.ts 按内容分流，由 parse/doc.ts 与 sniff.ts 负责报错。
 */

import { extractDocx } from './ooxml';
import { ParseError, unwrapDefault, type ParsedDoc, type ParsedPage } from './types';

/** 少于这个字数（不计空白）就认为没提到文字 */
const MIN_TEXT_CHARS = 10;

interface MammothLike {
  extractRawText: (options: { buffer: Buffer }) => Promise<{ value: string }>;
}

/** mammoth 只作为兜底：遇到自研提取器处理不了的包结构时再试一次，失败不抛错 */
async function extractWithMammoth(buffer: Buffer): Promise<string> {
  try {
    const mod = await import('mammoth');
    const mammoth = unwrapDefault<MammothLike>(mod);
    const result = await mammoth.extractRawText({ buffer });
    return result?.value ?? '';
  } catch {
    return '';
  }
}

function charCount(pages: ParsedPage[]): number {
  return pages.reduce((sum, page) => sum + page.text.replace(/\s/g, '').length, 0);
}

/**
 * 解析 Word（.docx）。
 * @throws ParseError NO_TEXT / PARSE_FAILED
 */
export async function parseDocx(buffer: Buffer): Promise<ParsedDoc> {
  let pages: ParsedPage[] = [];
  let structureError: ParseError | null = null;

  try {
    pages = extractDocx(buffer);
  } catch (error) {
    structureError =
      error instanceof ParseError
        ? error
        : new ParseError(
            `Word 解析失败：${error instanceof Error ? error.message : String(error)}`,
            'PARSE_FAILED',
          );
  }

  if (charCount(pages) < MIN_TEXT_CHARS) {
    const fallback = await extractWithMammoth(buffer);
    if (fallback.replace(/\s/g, '').length > charCount(pages)) {
      pages = [{ page: 1, text: fallback.trim() }];
    }
  }

  if (charCount(pages) < MIN_TEXT_CHARS) {
    // 结构性问题（缺部件/损坏）比「没文字」更具体，优先报它
    if (structureError) throw structureError;
    throw new ParseError(
      '这份 Word 里没有识别到文字，可能是纯图片 / 截图版文档。如果是扫描件，请先 OCR 成文字再上传。',
      'NO_TEXT',
    );
  }

  return { pages, pageCount: pages.length };
}