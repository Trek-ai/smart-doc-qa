/**
 * 最小 ZIP 读取器：零依赖，只用 node:zlib。
 * 只服务于 OOXML 解析——从 .docx 包里按需取出指定部件的内容。
 * 支持 store(0) / deflate(8) 两种压缩方式，并兼容 zip64 记录的大尺寸与大偏移。
 */

import { inflateRawSync } from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;

const SENTINEL32 = 0xffffffff;
/** 单个部件的解压上限，防止畸形包把内存吃光 */
const MAX_PART_BYTES = 64 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  /** 0 = 不压缩，8 = deflate */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** 本地文件头在缓冲区里的偏移 */
  localOffset: number;
}

/** ZIP 一定以 PK 开头；docx / xlsx / pptx 都是 ZIP 包 */
export function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

interface EndOfCentralDirectory {
  cdOffset: number;
  count: number;
}

/** 从尾部向前找 EOCD；注释最长 64KB，所以最多回退这么多 */
function findEocd(buffer: Buffer): EndOfCentralDirectory | null {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= lowest; i -= 1) {
    if (buffer.readUInt32LE(i) !== SIG_EOCD) continue;

    const count = buffer.readUInt16LE(i + 10);
    const cdSize = buffer.readUInt32LE(i + 12);
    const cdOffset = buffer.readUInt32LE(i + 16);
    if (count === 0xffff || cdSize === SENTINEL32 || cdOffset === SENTINEL32) {
      const zip64 = readZip64Eocd(buffer, i);
      if (zip64) return zip64;
    }
    return { cdOffset, count };
  }
  return null;
}

/** zip64 的 EOCD 记录紧跟在 locator（20 字节）之前 */
function readZip64Eocd(buffer: Buffer, eocdOffset: number): EndOfCentralDirectory | null {
  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== SIG_EOCD64_LOCATOR) return null;

  const recordOffset = Number(buffer.readBigUInt64LE(locatorOffset + 8));
  if (!Number.isSafeInteger(recordOffset) || recordOffset + 56 > buffer.length) return null;
  if (buffer.readUInt32LE(recordOffset) !== SIG_EOCD64) return null;

  return {
    count: Number(buffer.readBigUInt64LE(recordOffset + 32)),
    cdOffset: Number(buffer.readBigUInt64LE(recordOffset + 48)),
  };
}

/** extra field 里 0x0001 就是 zip64 的补充值，顺序固定：解压后大小 → 压缩后大小 → 本地头偏移 */
function readZip64Extra(
  buffer: Buffer,
  start: number,
  length: number,
  needed: { uncompressed: boolean; compressed: boolean; offset: boolean },
): { uncompressedSize?: number; compressedSize?: number; localOffset?: number } {
  const end = start + length;
  let cursor = start;
  const result: { uncompressedSize?: number; compressedSize?: number; localOffset?: number } = {};

  while (cursor + 4 <= end) {
    const id = buffer.readUInt16LE(cursor);
    const size = buffer.readUInt16LE(cursor + 2);
    if (id === 0x0001) {
      let p = cursor + 4;
      if (needed.uncompressed && p + 8 <= end) {
        result.uncompressedSize = Number(buffer.readBigUInt64LE(p));
        p += 8;
      }
      if (needed.compressed && p + 8 <= end) {
        result.compressedSize = Number(buffer.readBigUInt64LE(p));
        p += 8;
      }
      if (needed.offset && p + 8 <= end) {
        result.localOffset = Number(buffer.readBigUInt64LE(p));
      }
      return result;
    }
    cursor += 4 + size;
  }
  return result;
}

/** 读中央目录，拿到包内所有部件 */
export function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer);
  if (!eocd) return [];

  const entries: ZipEntry[] = [];
  let cursor = eocd.cdOffset;

  for (let i = 0; i < eocd.count; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== SIG_CENTRAL) break;

    const method = buffer.readUInt16LE(cursor + 10);
    let compressedSize = buffer.readUInt32LE(cursor + 20);
    let uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    let localOffset = buffer.readUInt32LE(cursor + 42);

    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const extraStart = cursor + 46 + nameLength;

    if (
      compressedSize === SENTINEL32 ||
      uncompressedSize === SENTINEL32 ||
      localOffset === SENTINEL32
    ) {
      const zip64 = readZip64Extra(buffer, extraStart, extraLength, {
        uncompressed: uncompressedSize === SENTINEL32,
        compressed: compressedSize === SENTINEL32,
        offset: localOffset === SENTINEL32,
      });
      uncompressedSize = zip64.uncompressedSize ?? uncompressedSize;
      compressedSize = zip64.compressedSize ?? compressedSize;
      localOffset = zip64.localOffset ?? localOffset;
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor = extraStart + extraLength + commentLength;
  }

  return entries;
}

/** 取出一个部件的原始字节；结构不合法或压缩方式不支持时返回 null */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
  if (entry.uncompressedSize > MAX_PART_BYTES) return null;

  const { localOffset } = entry;
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== SIG_LOCAL) return null;

  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) return null;

  const raw = buffer.subarray(start, end);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/** 取出一个部件并按 UTF-8 解码 */
export function readZipText(buffer: Buffer, entry: ZipEntry): string | null {
  const raw = readZipEntry(buffer, entry);
  return raw ? raw.toString('utf8') : null;
}