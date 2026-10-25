/**
 * OOXML（.docx）正文提取。
 *
 * 为什么不用 mammoth 一把梭：mammoth 的 extractRawText 只取 w:body 里的段落，
 * 文本框（w:txbxContent）、页眉页脚、脚注尾注、批注里的文字会被整段丢掉。
 * 真实 Word / WPS 文档里这些位置经常放着关键信息（封面用文本框、数据放脚注），
 * 实测「内容全在文本框」的文档会被 mammoth 判成空文档，混合文档则会静默丢内容。
 *
 * 这里直接按 XML 出现顺序取全部 w:t，并能：
 * - 保留段落换行、制表符、表格单元格分隔；
 * - 用 Word 记录的分页符（w:lastRenderedPageBreak / 手动分页符）还原页码，
 *   让 Word 文档的引用也能指到具体页，而不是永远「第 1 页」；
 * - 把页眉页脚、脚注尾注、批注补进来，不丢任何正文以外的文字。
 */

import { ParseError, type ParsedPage } from './types';
import { listZipEntries, readZipText, type ZipEntry } from './zip';

/**
 * 一次扫描同时处理这些标记：
 * 1 自闭合的空文本（必须先于成对文本，避免把 /> 当成开标签的一半）
 * 2 成对文本，捕获组是内容
 * 3 制表符 / 换行 / 分页符 / 段落结束 / 单元格结束
 */
const TOKEN =
  /<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab(?:\s[^>]*)?\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>|<w:lastRenderedPageBreak(?:\s[^>]*)?\/>|<\/w:p>|<\/w:tc>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** 还原 XML 实体；非法码点保持原样，不让一个坏字符毁掉整篇文档 */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;

  return text.replace(/&(#[xX]?[0-9a-fA-F]+|\w+);/g, (whole: string, body: string) => {
    try {
      if (/^#[xX]/.test(body)) {
        const code = Number.parseInt(body.slice(2), 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      if (body.startsWith('#')) {
        const code = Number.parseInt(body.slice(1), 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[body] ?? whole;
    } catch {
      return whole;
    }
  });
}

/** 按分页符切页：返回每一页的原始文本（可能含空页，交给上层清理） */
function sliceByPage(xml: string): string[] {
  const pages: string[] = [];
  let current = '';

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(xml)) !== null) {
    const token = match[0];

    if (match[1] !== undefined) {
      current += decodeEntities(match[1]);
    } else if (token.startsWith('<w:tab')) {
      current += '\t';
    } else if (token.startsWith('<w:br') || token.startsWith('<w:cr')) {
      // 手动分页符：w:type="page" 表示这一页到此为止
      if (/w:type\s*=\s*"page"/.test(token)) {
        pages.push(current);
        current = '';
      } else {
        current += '\n';
      }
    } else if (token.startsWith('<w:lastRenderedPageBreak')) {
      // Word 排版后写回的软分页标记：新页从这里开始
      pages.push(current);
      current = '';
    } else if (token === '</w:p>') {
      current += '\n';
    } else if (token === '</w:tc>') {
      current += '\t';
    }
  }

  pages.push(current);
  return pages;
}

/** 压掉排版噪声：行内空白折叠、空行删除、制表符保留为分隔 */
function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/** 原始切片 → 有序页码，空页不占号 */
function toPages(rawPages: string[]): ParsedPage[] {
  const pages: ParsedPage[] = [];
  for (const raw of rawPages) {
    const text = normalize(raw);
    if (text) pages.push({ page: pages.length + 1, text });
  }
  return pages;
}

/** 正文以外的文字来源：页眉页脚、脚注尾注、批注 */
const EXTRA_PART = /^word\/(?:(?:header|footer)\d*|footnotes|endnotes|comments)\.xml$/i;

function textOfPart(buffer: Buffer, entry: ZipEntry): string {
  const xml = readZipText(buffer, entry);
  if (!xml) return '';
  return normalize(sliceByPage(xml).join('\n'));
}

/**
 * 提取 .docx 的带页码文本。
 * @throws ParseError 包结构不合法或正文部件缺失
 */
export function extractDocx(buffer: Buffer): ParsedPage[] {
  const entries = listZipEntries(buffer);
  if (!entries.length) {
    throw new ParseError(
      '这个文件不是有效的 .docx（读不到内部结构），可能已损坏或后缀被改过。请用 Word 打开后「另存为」一份新的再上传。',
      'PARSE_FAILED',
    );
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const mainName = byName.has('word/document.xml')
    ? 'word/document.xml'
    : entries.find((entry) => /^word\/document\d*\.xml$/i.test(entry.name))?.name;

  if (!mainName) {
    throw new ParseError(
      '这个 .docx 里没有正文部件，文件可能已损坏。请用 Word 打开后「另存为」一份新的再上传。',
      'PARSE_FAILED',
    );
  }

  const mainEntry = byName.get(mainName);
  const mainXml = mainEntry ? readZipText(buffer, mainEntry) : null;
  if (!mainXml) {
    throw new ParseError('这个 .docx 的正文解压失败，文件可能已损坏。请重新另存一份再上传。', 'PARSE_FAILED');
  }

  const pages = toPages(sliceByPage(mainXml));

  // 页眉页脚 / 脚注尾注 / 批注：拼到第 1 页之后，保证这些文字同样可被检索
  const extras = entries
    .filter((entry) => EXTRA_PART.test(entry.name))
    .map((entry) => textOfPart(buffer, entry))
    .filter(Boolean);

  if (extras.length) {
    const merged = extras.join('\n');
    if (pages.length) {
      pages[0] = { page: pages[0].page, text: `${pages[0].text}\n${merged}`.trim() };
    } else {
      pages.push({ page: 1, text: merged });
    }
  }

  return pages;
}