/**
 * 入库流水线：解析 -> 切分 -> 落库。
 * 单份文档的块数有上限，避免超大文档把内存吃满。
 */

import { nanoid } from 'nanoid';

import type { Doc } from './api';
import { splitText } from './chunk';
import { config } from './config';
import type { Chunk } from './model';
import { parseDocument } from './parse';
import { getStore } from './store';

/** 单份文档最多保留的块数 */
const MAX_CHUNKS_PER_DOC = 600;

/**
 * 把上传的文件处理成可检索的知识块并入库。
 * 同名同大小的文件视为重复上传，直接返回已有记录，不重复建索引。
 * @returns 入库后的文档记录
 * @throws ParseError 解析失败
 */
export async function ingestFile(name: string, buffer: Buffer): Promise<Doc> {
  const store = getStore();

  const duplicate = await store.findDuplicate(name, buffer.byteLength);
  if (duplicate) return duplicate;

  const parsed = await parseDocument(name, buffer);
  const docId = nanoid(10);

  const chunks: Chunk[] = [];
  let order = 0;

  for (const page of parsed.pages) {
    for (const text of splitText(page.text)) {
      if (order >= MAX_CHUNKS_PER_DOC) break;
      chunks.push({
        id: `${docId}-${order}`,
        docId,
        docName: name,
        page: page.page,
        order,
        text,
      });
      order += 1;
    }
    if (order >= MAX_CHUNKS_PER_DOC) break;
  }

  if (!chunks.length) {
    throw new Error('文件里没有切出可检索的内容。');
  }

  const doc: Doc = {
    id: docId,
    name,
    size: buffer.byteLength,
    pages: parsed.pageCount,
    chunks: chunks.length,
    status: 'ready',
    createdAt: Date.now(),
  };

  await store.addDoc(doc, chunks);
  return doc;
}

/** 上传上限的展示文案：整数就不带小数，否则保留一位 */
export function uploadLimitLabel(bytes: number = config.maxUploadBytes): string {
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}