/**
 * 补充声明：这里只放第三方包缺失的类型，包自身带类型的不在此列。
 */

declare module '*.css';

/** word-extractor 没有自带类型声明，按其 README 的实际 API 声明最小可用类型 */
declare module 'word-extractor' {
  interface ExtractedDocument {
    getBody(): string;
    getHeaders?(): string;
    getFooters?(): string;
    getFootnotes?(): string;
    getEndnotes?(): string;
    getAnnotations?(): string;
    getTextboxes?(): string;
  }

  class WordExtractor {
    /** 可传文件路径或文件内容（Buffer） */
    extract(source: string | Buffer): Promise<ExtractedDocument>;
  }

  export = WordExtractor;
}