/**
 * 索引存储：进程内存 + 落盘 JSON（本地形态，重启后自动恢复）。
 * 用 globalThis 缓存实例，避免开发模式热更新导致索引被清空。
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Doc } from './api';
import { config } from './config';
import type { Chunk } from './model';

/** 单实例内存索引上限，防止极端情况下把内存吃满 */
const MAX_CHUNKS = 8000;

interface State {
  docs: Doc[];
  chunks: Chunk[];
}

class Store {
  private state: State = { docs: [], chunks: [] };
  private loaded = false;
  private writable = true;
  private writing: Promise<void> = Promise.resolve();

  private get file(): string {
    return path.join(config.dataDir, 'index.json');
  }

  /** 首次访问时从磁盘恢复；失败就当作空索引 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<State>;
      if (Array.isArray(parsed.docs) && Array.isArray(parsed.chunks)) {
        this.state.docs = parsed.docs;
        this.state.chunks = parsed.chunks;
      }
    } catch {
      // 文件不存在或不可读，保持空索引
    }
  }

  private persist(): Promise<void> {
    if (!this.writable) return Promise.resolve();

    const payload = JSON.stringify(this.state);
    this.writing = this.writing.then(async () => {
      try {
        await fs.mkdir(config.dataDir, { recursive: true });
        const tmp = `${this.file}.${randomUUID().slice(0, 8)}.tmp`;
        await fs.writeFile(tmp, payload, 'utf8');
        await fs.rename(tmp, this.file);
      } catch {
        // 磁盘写不进去（权限/空间）：本次之后不再重试，内存索引照常可用
        this.writable = false;
      }
    });

    return this.writing;
  }

  async allDocs(): Promise<Doc[]> {
    await this.ensureLoaded();
    return [...this.state.docs].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 同名同大小视为重复上传，直接返回已有文档，不重复建索引 */
  async findDuplicate(name: string, size: number): Promise<Doc | undefined> {
    await this.ensureLoaded();
    return this.state.docs.find((d) => d.name === name && d.size === size);
  }

  async addDoc(doc: Doc, chunks: Chunk[]): Promise<void> {
    await this.ensureLoaded();
    this.state.docs = this.state.docs.filter((d) => d.id !== doc.id);
    this.state.chunks = this.state.chunks.filter((c) => c.docId !== doc.id);
    this.state.docs.push(doc);
    this.state.chunks.push(...chunks.slice(0, MAX_CHUNKS));
    await this.persist();
  }

  async removeDoc(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.state.docs.length;
    this.state.docs = this.state.docs.filter((d) => d.id !== id);
    this.state.chunks = this.state.chunks.filter((c) => c.docId !== id);
    if (this.state.docs.length === before) return false;
    await this.persist();
    return true;
  }

  /** 取指定文档的知识块；docIds 为空表示全部 */
  async chunksOf(docIds: string[]): Promise<Chunk[]> {
    await this.ensureLoaded();
    if (!docIds.length) return [...this.state.chunks];
    const set = new Set(docIds);
    return this.state.chunks.filter((c) => set.has(c.docId));
  }

  async stats(): Promise<{ docs: number; chunks: number }> {
    await this.ensureLoaded();
    return {
      docs: this.state.docs.length,
      chunks: this.state.chunks.length,
    };
  }
}

const KEY = '__zhiyuan_store__';
const holder = globalThis as unknown as Record<string, Store | undefined>;

export function getStore(): Store {
  if (!holder[KEY]) holder[KEY] = new Store();
  return holder[KEY];
}

export type { Store };