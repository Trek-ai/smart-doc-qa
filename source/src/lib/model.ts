/** 服务端数据模型。 */

/** 切分后的知识块；页码来自解析层，引用与展示都依赖它 */
export interface Chunk {
  id: string;
  docId: string;
  docName: string;
  /** 从 1 开始 */
  page: number;
  /** 文档内顺序，用于稳定排序 */
  order: number;
  text: string;
}