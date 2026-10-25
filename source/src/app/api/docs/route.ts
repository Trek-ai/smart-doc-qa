/** 文档列表与删除。 */

import { NextResponse } from 'next/server';

import type { ApiError } from '@/lib/api';
import { activeModel, config } from '@/lib/config';
import { getStore } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const store = getStore();
  return NextResponse.json({
    docs: await store.allDocs(),
    stats: await store.stats(),
    model: activeModel(),
    /** 上传上限，前端据此提前拦下过大的文件 */
    uploadLimitBytes: config.maxUploadBytes,
  });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json<ApiError>({ error: '缺少 id 参数。' }, { status: 400 });
  }

  const removed = await getStore().removeDoc(id);
  if (!removed) {
    return NextResponse.json<ApiError>({ error: '这份文档不存在或已被删除。' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, stats: await getStore().stats() });
}