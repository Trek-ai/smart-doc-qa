/** 解析入口：先按内容定性，再按后缀分发；不支持的类型在这里统一兜住。 */

import { parseLegacyDoc } from './doc';
import { parseDocx } from './docx';
import { parsePdf } from './pdf';
import { sniff } from './sniff';
import { parsePlainText } from './text';
import { ParseError, type ParsedDoc } from './types';
import { isZip } from './zip';

export { ParseError } from './types';
export type { ParsedDoc, ParsedPage } from './types';

const SUPPORTED = ['.pdf', '.docx', '.doc', '.txt', '.md'];

/** Word 两种格式（新包 + 旧二进制）走同一条分流逻辑 */
function isWordName(name: string): boolean {
  return name.endsWith('.docx') || name.endsWith('.doc');
}

export function supportedExtensions(): string {
  return SUPPORTED.join(' / ');
}

/** 文件类型判定：只区分「支持」与「不支持」——Word 的新旧两种格式现在都能直接读 */
export function isSupportedFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED.some((ext) => lower.endsWith(ext));
}

/**
 * 解析上传文件。
 * @param name 原始文件名，用于判断类型
 * @param buffer 文件内容
 * @throws ParseError
 */
export async function parseDocument(name: string, buffer: Buffer): Promise<ParsedDoc> {
  const lower = name.toLowerCase();

  if (isWordName(lower)) {
    // 后缀会骗人：.docx 里装着旧版 .doc、.doc 里装着 .docx 包都很常见，按内容决定解析器
    return isZip(buffer) ? parseDocx(buffer) : parseLegacyDoc(buffer);
  }
  if (lower.endsWith('.pdf')) return parsePdf(buffer);
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return parsePlainText(buffer);

  if (sniff(buffer) === 'legacy-doc') {
    throw new ParseError(
      `这其实是一份旧版 Word（.doc）文档，请把后缀改回 .doc 后重新上传。`,
      'UNSUPPORTED_TYPE',
    );
  }

  throw new ParseError(`暂不支持这种文件类型，请上传 ${supportedExtensions()} 文件。`, 'UNSUPPORTED_TYPE');
}