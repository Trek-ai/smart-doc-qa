/**
 * PDF 解析：按坐标重排后取文。
 *
 * 为什么不是直接调一个取文库了事：真实 PDF 的内容流经常不按视觉顺序输出。
 * 实测内置示例文档里「社区图书馆预约系统 · 产品需求文档」在内容流里是
 * 社区 / 系 / 图书馆预约 / 统 / · / 品需求文档 / 产 这样乱序的片段，
 * 谁按输出顺序拼接，谁就会拿到「一、 目背景 项」这种断字——引用面板会直接把断字给用户看，
 * 关键词检索也会因为词被打散而召不准。这里拿 pdf.js 的 textContent，
 * 先按 y 聚成行、行内按 x 排序，再拼成行文本。
 *
 * 已知限制：多栏排版（如双栏论文）会被读成「逐行左右拼接」，
 * 本文档工具面向单栏办公文档，遇到多栏 PDF 时行序可能与视觉顺序不同。
 */

import { ParseError, type ParsedDoc, type ParsedPage } from './types';

/** 同一行的 y 容差（PDF 坐标单位，约 3pt 内的偏移视为同一行） */
const LINE_TOLERANCE = 3;
/** 行内相邻片段横向间距超过这个值就补一个空格 */
const WORD_GAP = 1.5;

interface RawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 栏间空白带的位置（页面横向坐标） */
interface Gutter {
  start: number;
  end: number;
}

/** 栏间空白至少要这么宽（pt），且不小于行高的 1.4 倍 */
const GUTTER_MIN_WIDTH = 14;
/** 这条空白带必须在纵向大部分高度上都是空的 */
const GUTTER_MIN_EMPTY_RATIO = 0.55;
/** 每一栏的条目宽度中位数至少要占正文宽度的这个比例（用来把表格排除掉） */
const GUTTER_MIN_ITEM_WIDTH_RATIO = 0.15;

interface PdfTextContent {
  items: unknown[];
}

interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  getDocument(options: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    isEvalSupported?: boolean;
  }): { promise: Promise<PdfDocument> };
}

/** 兼容 ESM 命名导出与 CJS default 导出两种形态 */
async function loadPdfJs(): Promise<PdfJsModule> {
  const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as {
    getDocument?: PdfJsModule['getDocument'];
    default?: PdfJsModule;
  };
  const api = typeof mod.getDocument === 'function' ? (mod as unknown as PdfJsModule) : mod.default;
  if (!api || typeof api.getDocument !== 'function') {
    throw new ParseError('PDF 解析组件加载失败，请重新安装依赖。', 'PARSE_FAILED');
  }
  return api;
}

/** 把 textContent 里的可见文本片段挑出来，带上坐标 */
function toRawItems(content: PdfTextContent): RawItem[] {
  const items: RawItem[] = [];

  for (const entry of content.items) {
    const item = entry as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    if (typeof item.str !== 'string' || !item.str || !Array.isArray(item.transform)) continue;

    const transform = item.transform as number[];
    items.push({
      str: item.str,
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width: typeof item.width === 'number' ? item.width : 0,
      height: typeof item.height === 'number' ? item.height : Math.abs(Number(transform[3])) || 0,
    });
  }

  return items;
}

/** 空白片段（生成器有时会用它来定位后面那段文字） */
function isBlankItem(item: RawItem): boolean {
  return item.str.trim().length === 0;
}

/** 该位置之后的第一个非空白片段 */
function nextVisible(items: RawItem[], from: number): RawItem | undefined {
  for (let i = from + 1; i < items.length; i += 1) {
    if (!isBlankItem(items[i])) return items[i];
  }
  return undefined;
}

/**
 * 行内拼接：按 x 排序，间距大的地方补空格，压掉多余空白。
 *
 * 实测坑：不少生成器会先输出一个空白片段再输出文字，两者坐标几乎重合
 * （示例文档标题里「社区图书馆预约系统」就带着 4 个这样的空白片段）。
 * 这种空白不是真空格——真空格的下一段文字从它的末尾开始。
 * 按「下一个非空白片段的起点是否几乎重合」把它丢掉，
 * 否则标题会变成「社区 图书馆预约 系统」，检索时二元组被空格切断，引用面板也难看。
 */
function joinLine(items: RawItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = '';
  let previous: RawItem | null = null;

  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i];

    if (isBlankItem(item)) {
      const next = nextVisible(sorted, i);
      if (next && next.x - item.x < 1) continue;
    }

    if (previous) {
      const gap = item.x - (previous.x + previous.width);
      if (gap > WORD_GAP) text += ' ';
    }
    text += item.str;
    previous = item;
  }

  return text.replace(/\s+/g, ' ').trim();
}

/** 按 y 聚行；行内保持原顺序，后面按 x 排序 */
function groupIntoLines(items: RawItem[]): RawItem[][] {
  // 先按 y 从上到下（PDF 原点在左下，y 越大越靠上）
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const groups: RawItem[][] = [];
  for (const item of sorted) {
    const current = groups[groups.length - 1];
    if (current && Math.abs(current[0].y - item.y) <= LINE_TOLERANCE) current.push(item);
    else groups.push([item]);
  }
  return groups;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 这组条目横向覆盖了多少高度（用来判断两栏是不是贯穿整页） */
function verticalSpan(items: RawItem[]): number {
  if (!items.length) return 0;
  const ys = items.map((item) => item.y);
  return Math.max(...ys) - Math.min(...ys);
}

/** 这组条目的宽度中位数 */
function medianWidth(items: RawItem[]): number {
  return median(items.map((item) => item.width).filter((width) => width > 0));
}

/** 一组条目覆盖的 y 区间去重后总长度 */
function blockedHeight(spans: [number, number][], from: number, to: number): number {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let blocked = 0;
  let cursor = from;
  for (const [start, end] of sorted) {
    const begin = Math.max(start, cursor);
    if (end > begin) {
      blocked += Math.min(end, to) - begin;
      cursor = end;
    }
  }
  return blocked;
}

/**
 * 检测双栏排版里的「栏间空白带」。
 *
 * 为什么要单独做：双栏 PDF 的内容流是「左栏一行 → 右栏一行 → 左栏下一行」，
 * 只按 y 分行、行内按 x 排序，会把左右两栏同高度的行拼成一行，
 * 读出来就是「左栏第一行… 右栏第一行…」这种横跳的句子。
 *
 * 判定条件（都满足才算双栏，宁可漏判也不能把单栏文档判错）：
 * 1. 空白带够宽，且横向位置不在正文两端；
 * 2. 这条带子在纵向大部分高度上确实没有文字（表格的栏间距只在自己那几行空着）；
 * 3. 两侧各自至少 2 行、条目数各占两成以上；
 * 4. 两侧条目的宽度中位数都要够宽——这一条专门用来排除表格：
 *    表格单元格又短又碎，两栏正文的每一行都是长长的一段。
 */
function detectGutter(groups: RawItem[][]): Gutter | null {
  const visible = groups.flat().filter((item) => item.str.trim().length > 0);
  if (visible.length < 6) return null;

  const minX = Math.min(...visible.map((item) => item.x));
  const maxX = Math.max(...visible.map((item) => item.x + item.width));
  const textWidth = maxX - minX;
  if (textWidth < 120) return null;

  const lineHeight = median(visible.map((item) => item.height).filter((height) => height > 0)) || 10;
  const minGutter = Math.max(GUTTER_MIN_WIDTH, lineHeight * 1.4);

  // 横跨整页的单个文字片段（标题、摘要那种一整段）会盖住栏间空白带，先剔掉再找栏位。
// 注意要按「单个片段」的宽度判断，不能按「一整行」的宽度——双栏的一行本来就横跨整页
// （左边一段 + 右边一段），按行宽判会把正文全剔掉。
  const wideLimit = textWidth * 0.6;
  const body = visible.filter((item) => item.width > 0 && item.width < wideLimit);
  if (body.length < 6) return null;

  // 用 1pt 的格子记录哪些横向位置有正文
  const bins = Math.ceil(textWidth) + 2;
  const covered = new Array<boolean>(bins).fill(false);
  for (const item of body) {
    const from = Math.max(0, Math.floor(item.x - minX));
    const to = Math.min(bins - 1, Math.ceil(item.x + item.width - minX));
    for (let bin = from; bin <= to; bin += 1) covered[bin] = true;
  }

  const margin = Math.max(4, Math.round(textWidth * 0.03));
  let best = { start: -1, end: -1, width: 0 };
  let run = -1;
  for (let bin = margin; bin < bins - margin; bin += 1) {
    if (!covered[bin]) {
      if (run < 0) run = bin;
      continue;
    }
    if (run >= 0) {
      if (bin - run > best.width) best = { start: run, end: bin, width: bin - run };
      run = -1;
    }
  }
  if (run >= 0 && bins - margin - run > best.width) {
    best = { start: run, end: bins - margin, width: bins - margin - run };
  }

  if (best.width < minGutter) return null;

  const gutter: Gutter = { start: minX + best.start, end: minX + best.end };
  const minY = Math.min(...visible.map((item) => item.y));
  const maxY = Math.max(...visible.map((item) => item.y + item.height));
  const textHeight = maxY - minY;
  if (textHeight <= 0) return null;

  // 条件 2：空白带纵向要真空（按正文条目算，通栏行不算）
  const crossing: [number, number][] = body
    .filter((item) => item.x < gutter.end && item.x + item.width > gutter.start)
    .map((item) => [item.y, item.y + item.height] as [number, number]);
  const emptyRatio = (textHeight - blockedHeight(crossing, minY, maxY)) / textHeight;
  if (emptyRatio < GUTTER_MIN_EMPTY_RATIO) return null;

  // 条件 3、4：两侧都要有像样的正文
  const left = body.filter((item) => item.x + item.width <= gutter.start + 1);
  const right = body.filter((item) => item.x >= gutter.end - 1);
  const linesOf = (list: RawItem[]) => new Set(list.map((item) => Math.round(item.y))).size;
  if (linesOf(left) < 2 || linesOf(right) < 2) return null;
  if (left.length < body.length * 0.2 || right.length < body.length * 0.2) return null;

  const minItemWidth = textWidth * GUTTER_MIN_ITEM_WIDTH_RATIO;
  if (medianWidth(left) < minItemWidth || medianWidth(right) < minItemWidth) return null;

  // 两侧都得有一定纵向跨度（栏是竖着排的，不是表格里的零星几格）
  if (verticalSpan(left) <= 0 || verticalSpan(right) <= 0) return null;

  return gutter;
}

/** 双栏输出：通栏行（标题/摘要）原位输出，两侧正文分别按栏读完 */
function joinColumns(groups: RawItem[][], gutter: Gutter): string[] {
  const out: string[] = [];
  let left: string[] = [];
  let right: string[] = [];

  const flush = () => {
    out.push(...left, ...right);
    left = [];
    right = [];
  };

  for (const group of groups) {
    // 判版面时只认有字的条目：空白条目经常横跨栏间空白带（生成器用来定位），
    // 让它参与判断会把两栏正文误判成「通栏行」，左右栏又被拼回一行。
    const meaningful = group.filter((item) => item.str.trim().length > 0);
    if (!meaningful.length) continue;

    const crossing = meaningful.some((item) => item.x < gutter.end && item.x + item.width > gutter.start);
    if (crossing) {
      // 通栏行：先把已经攒下的两栏正文按「左栏→右栏」吐出去，再输出这一行
      flush();
      const line = joinLine(meaningful);
      if (line) out.push(line);
      continue;
    }

    const leftLine = joinLine(meaningful.filter((item) => item.x + item.width <= gutter.start + 1));
    const rightLine = joinLine(meaningful.filter((item) => item.x >= gutter.end - 1));
    if (leftLine) left.push(leftLine);
    if (rightLine) right.push(rightLine);
  }

  flush();
  return out;
}

/** 按 y 聚行、行内按 x 排序，得到阅读顺序；检测到双栏时按栏输出 */
function toLines(content: PdfTextContent): string[] {
  const items = toRawItems(content);
  if (!items.length) return [];

  const groups = groupIntoLines(items);
  const gutter = detectGutter(groups);
  if (!gutter) return groups.map(joinLine).filter((line) => line.length > 0);

  return joinColumns(groups, gutter);
}

/** 把 pdf.js 的报错翻译成中文的 ParseError */
function translate(error: unknown): ParseError {
  const name = (error as { name?: string })?.name ?? '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'PasswordException' || /password|encrypt/i.test(message)) {
    return new ParseError('这份 PDF 带密码保护，请先解除密码再上传。', 'ENCRYPTED_PDF');
  }
  if (name === 'InvalidPDFException') {
    return new ParseError('这个文件不是有效的 PDF（可能已损坏或后缀被改过）。', 'PARSE_FAILED');
  }
  return new ParseError(`PDF 解析失败：${message}`, 'PARSE_FAILED');
}

/**
 * 解析 PDF。
 * @throws ParseError ENCRYPTED_PDF / SCANNED_PDF / PARSE_FAILED
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDoc> {
  const pdfjs = await loadPdfJs();

  let doc: PdfDocument;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: false,
      isEvalSupported: false,
    }).promise;
  } catch (error) {
    throw translate(error);
  }

  try {
    const pages: ParsedPage[] = [];

    for (let num = 1; num <= doc.numPages; num += 1) {
      const page = await doc.getPage(num);
      const content = await page.getTextContent();
      const text = toLines(content).join('\n').trim();
      // 空白页不占页码，引用定位仍以原始页号为准
      if (text) pages.push({ page: num, text });
    }

    const total = pages.reduce((sum, page) => sum + page.text.replace(/\s/g, '').length, 0);
    if (total < 20) {
      throw new ParseError(
        '没有从这份 PDF 里识别到文字，它可能是扫描件（图片版）。请改用带文字层的 PDF，或先做 OCR。',
        'SCANNED_PDF',
      );
    }

    return { pages, pageCount: doc.numPages };
  } catch (error) {
    throw error instanceof ParseError ? error : translate(error);
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}