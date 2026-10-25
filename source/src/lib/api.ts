/**
 * 前后端共享的接口契约（唯一真源）。
 * 改动这里必须同步改服务端与页面，不得单方面修改。
 */

export type DocStatus = 'ready' | 'error';

/** 一份已入库的文档 */
export interface Doc {
  id: string;
  name: string;
  /** 原始字节数 */
  size: number;
  /** 页码数；纯文本记 1 页 */
  pages: number;
  /** 切分出的块数 */
  chunks: number;
  status: DocStatus;
  createdAt: number;
  error?: string;
}

/** 回答中的一条引用，index 与正文里的 [n] 角标一一对应 */
export interface Citation {
  index: number;
  docId: string;
  docName: string;
  page: number;
  text: string;
  /** 相关度分，仅用于排序与展示 */
  score: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 本条提问命中的文档编号（与左侧列表编号一致），用于界面回显提问范围 */
  scope?: number[];
  citations?: Citation[];
  /** 产生这条回答的问题，用于引用面板里高亮命中词 */
  question?: string;
  createdAt: number;
  error?: string;
}

/** 服务端推送的事件 */
export type SSEEvent =
  | { type: 'token'; text: string }
  | { type: 'citations'; items: Citation[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ApiError {
  error: string;
  /** 机器可读的错误码，前端据此给不同的引导文案 */
  code?:
    | 'SCANNED_PDF'
    | 'ENCRYPTED_PDF'
    | 'ENCRYPTED_DOCX'
    | 'UNSUPPORTED_TYPE'
    | 'TOO_LARGE'
    | 'NO_TEXT'
    | 'UPSTREAM'
    | 'NO_KEY';
}