/** 入库接口：接收文件，返回已入库的文档记录。 */

import { NextResponse } from 'next/server';

import type { ApiError } from '@/lib/api';
import { config } from '@/lib/config';
import { ingestFile, uploadLimitLabel } from '@/lib/ingest';
import { isSupportedFileName, ParseError, supportedExtensions } from '@/lib/parse';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_MAP: Record<string, ApiError['code']> = {
  SCANNED_PDF: 'SCANNED_PDF',
  ENCRYPTED_PDF: 'ENCRYPTED_PDF',
  ENCRYPTED_DOCX: 'ENCRYPTED_DOCX',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  NO_TEXT: 'NO_TEXT',
  PARSE_FAILED: 'UPSTREAM',
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json<ApiError>({ error: '没有收到文件。' }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json<ApiError>({ error: '这个文件是空的，没有可索引的内容。' }, { status: 400 });
    }

    if (file.size > config.maxUploadBytes) {
      return NextResponse.json<ApiError>(
        { error: `文件超过 ${uploadLimitLabel()} 上限，请拆分后再上传。`, code: 'TOO_LARGE' },
        { status: 413 },
      );
    }

    if (!isSupportedFileName(file.name)) {
      return NextResponse.json<ApiError>(
        { error: `暂不支持这种文件类型，请上传 ${supportedExtensions()} 文件。`, code: 'UNSUPPORTED_TYPE' },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const doc = await ingestFile(file.name, buffer);

    return NextResponse.json({ doc, stats: await getStore().stats() });
  } catch (error) {
    if (error instanceof ParseError) {
      return NextResponse.json<ApiError>(
        { error: error.message, code: CODE_MAP[error.code] ?? 'UPSTREAM' },
        { status: 422 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json<ApiError>({ error: `入库失败：${message}` }, { status: 500 });
  }
}