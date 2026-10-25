/**
 * 文件头嗅探：后缀经常骗人——.docx 里装着 .doc、.doc 里装着 RTF、PDF 被改成 Word 后缀。
 * 先按内容定性，再决定用哪个解析器、报哪一种错。
 */

import { ParseError } from './types';
import { isZip } from './zip';

export type SniffedKind = 'zip' | 'encrypted-ole' | 'legacy-doc' | 'ole' | 'rtf' | 'pdf' | 'unknown';

const OLE_MAGIC = [0xd0cf11e0, 0xa1b11ae1];

function containsAscii(buffer: Buffer, needle: string): boolean {
  return buffer.includes(Buffer.from(needle, 'latin1'));
}

/** OLE 目录里的流名是 UTF-16LE，文件中间也可能出现 ASCII 形态，两种都查 */
function containsUtf16(buffer: Buffer, needle: string): boolean {
  return buffer.includes(Buffer.from(needle, 'utf16le'));
}

function marked(buffer: Buffer, name: string): boolean {
  return containsAscii(buffer, name) || containsUtf16(buffer, name);
}

/** 判断文件真实类型（不看后缀） */
export function sniff(buffer: Buffer): SniffedKind {
  if (isZip(buffer)) return 'zip';

  const head = buffer.subarray(0, 8).toString('latin1');
  const isOle =
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === OLE_MAGIC[0] &&
    buffer.readUInt32BE(4) === OLE_MAGIC[1];

  if (isOle) {
    if (marked(buffer, 'EncryptedPackage') || marked(buffer, 'EncryptionInfo')) return 'encrypted-ole';
    if (marked(buffer, 'WordDocument')) return 'legacy-doc';
    return 'ole';
  }
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (head.startsWith('%PDF')) return 'pdf';
  return 'unknown';
}

/**
 * 嗅探结果能直接定性时，给出对得上号的提示。
 * @param kind 嗅探结果
 * @param suffix 用户上传时的后缀，仅用于文案
 */
export function sniffError(kind: SniffedKind, suffix: string): ParseError | null {
  switch (kind) {
    case 'encrypted-ole':
      return new ParseError(
        '这份 Word 带密码保护，读不到内容。请先用 Word 打开并取消密码（或另存为不加密的 .docx）再上传。',
        'ENCRYPTED_DOCX',
      );
    case 'ole':
      return new ParseError(
        `这个 ${suffix} 是 Office 旧格式容器，但不是 Word 文本（可能是表格或演示文稿）。请上传 Word / PDF / 文本文件。`,
        'UNSUPPORTED_TYPE',
      );
    case 'rtf':
      return new ParseError(
        '这个文件其实是 RTF 格式，不是 Word 二进制文档。请在 Word 里「另存为 → Word 文档(*.docx)」后重试。',
        'UNSUPPORTED_TYPE',
      );
    case 'pdf':
      return new ParseError('这个文件其实是 PDF（后缀写成了 Word）。请直接上传 PDF 原件。', 'UNSUPPORTED_TYPE');
    case 'unknown':
      return new ParseError(
        '这个文件不是有效的 Word 文档（可能已损坏或后缀被改过）。请用 Word 打开后「另存为」一份新的再上传。',
        'PARSE_FAILED',
      );
    default:
      return null;
  }
}