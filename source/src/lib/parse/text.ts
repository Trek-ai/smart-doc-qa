/** 纯文本 / Markdown 解析。 */

import { ParseError, type ParsedDoc } from './types';

export function parsePlainText(buffer: Buffer): ParsedDoc {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (text.replace(/\s/g, '').length < 5) {
    throw new ParseError('这个文件是空的，没有可索引的内容。', 'NO_TEXT');
  }
  return { pages: [{ page: 1, text }], pageCount: 1 };
}