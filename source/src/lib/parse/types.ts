/**
 * 文档解析层：把上传的文件转成「带页码的纯文本」。
 * 页码是引用功能的前提，解析不出来的文件在这里就被拦下并给出明确原因。
 */

export interface ParsedPage {
  /** 从 1 开始 */
  page: number;
  text: string;
}

export interface ParsedDoc {
  pages: ParsedPage[];
  pageCount: number;
}

/** 解析期可识别的失败原因 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'SCANNED_PDF'
      | 'ENCRYPTED_PDF'
      | 'ENCRYPTED_DOCX'
      | 'UNSUPPORTED_TYPE'
      | 'NO_TEXT'
      | 'PARSE_FAILED',
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/** CJS 模块的 default 可能在多层里，统一拆出来 */
export function unwrapDefault<T>(mod: unknown): T {
  const anyMod = mod as { default?: { default?: unknown } | unknown };
  const first = anyMod?.default ?? mod;
  const second = (first as { default?: unknown })?.default ?? first;
  return second as T;
}