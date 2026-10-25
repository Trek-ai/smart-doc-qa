/**
 * 旧版 Word（.doc，Word 97-2003 / WPS 保存的二进制格式）解析。
 *
 * 这类文件是 OLE 复合文档，正文放在 WordDocument 流里，靠 word-extractor 读；
 * 它同时能取出文本框、页眉页脚、脚注尾注、批注——和 .docx 路径保持同样的「不丢内容」标准。
 *
 * 页码：.doc 不存分页表，只有手动分页符（\f）能还原页码；文档里没有分页符时就如实记 1 页。
 * 中途的 .doc 很常见（很多单位至今用 WPS 存 .doc），所以这里不做「请另存为 .docx」的推诿，
 * 直接读得出来就读。
 */

import { ParseError, unwrapDefault, type ParsedDoc, type ParsedPage } from './types';
import { sniff, sniffError } from './sniff';

/** 少于这个字数（不计空白）就认为没提到文字 */
const MIN_TEXT_CHARS = 10;

interface ExtractedDocument {
  getBody(): string;
  getHeaders?(): string;
  getFooters?(): string;
  getFootnotes?(): string;
  getEndnotes?(): string;
  getAnnotations?(): string;
  getTextboxes?(): string;
}

interface WordExtractorLike {
  extract(source: Buffer): Promise<ExtractedDocument>;
}

async function loadExtractor(): Promise<WordExtractorLike> {
  const mod = await import('word-extractor');
  const Ctor = unwrapDefault<new () => WordExtractorLike>(mod);
  if (typeof Ctor !== 'function') {
    throw new ParseError('Word 解析组件加载失败，请重新安装依赖。', 'PARSE_FAILED');
  }
  return new Ctor();
}

/** 正文以外的文字：文本框、页眉页脚、脚注尾注、批注都要，别丢 */
function extrasOf(doc: ExtractedDocument): string[] {
  const parts = [
    doc.getTextboxes?.(),
    doc.getHeaders?.(),
    doc.getFooters?.(),
    doc.getFootnotes?.(),
    doc.getEndnotes?.(),
    doc.getAnnotations?.(),
  ];
  return parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
}

/** 行内空白折叠、空行去掉，与 docx / pdf 路径的输出风格保持一致 */
function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/** 按手动分页符切页；没有分页符就整篇算 1 页 */
function toPages(text: string): ParsedPage[] {
  const pages: ParsedPage[] = [];
  for (const raw of text.split('\f')) {
    const page = normalize(raw);
    if (page) pages.push({ page: pages.length + 1, text: page });
  }
  return pages;
}

function charCount(pages: ParsedPage[]): number {
  return pages.reduce((sum, page) => sum + page.text.replace(/\s/g, '').length, 0);
}

/**
 * 解析旧版 .doc。
 * @throws ParseError ENCRYPTED_DOCX / UNSUPPORTED_TYPE / NO_TEXT / PARSE_FAILED
 */
export async function parseLegacyDoc(buffer: Buffer): Promise<ParsedDoc> {
  const fatal = sniffError(sniff(buffer), '.doc');
  if (fatal) throw fatal;

  const extractor = await loadExtractor();

  let doc: ExtractedDocument;
  try {
    doc = await extractor.extract(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ParseError(
      `旧版 Word（.doc）解析失败：${message}。请在 Word 里「另存为 → Word 文档(*.docx)」后重试。`,
      'PARSE_FAILED',
    );
  }

  const body = normalize(doc.getBody() ?? '');
  const extras = extrasOf(doc).map(normalize).filter(Boolean);
  const pages = toPages([body, ...extras].filter(Boolean).join('\n'));

  if (charCount(pages) < MIN_TEXT_CHARS) {
    throw new ParseError(
      '这份 Word 里没有识别到文字，可能是纯图片 / 截图版文档。如果是扫描件，请先 OCR 成文字再上传。',
      'NO_TEXT',
    );
  }

  return { pages, pageCount: pages.length };
}