/** 回答与原文的渲染：把 [n] 角标变成可点按钮，把命中词标出来。 */

import type { ReactNode } from 'react';

import type { Citation } from '@/lib/api';

const CITATION_TOKEN = /(\[\d+\])/g;

/**
 * 渲染回答正文：把 [n] 渲染成可点按钮，其余文字原样输出。
 * @param content 回答正文（保留换行，由外层用 whitespace-pre-wrap 处理）
 * @param citations 本次回答命中的引用
 * @param onPick 点击角标时回调，参数是引用编号
 */
export function renderAnswer(
  content: string,
  citations: Citation[],
  onPick: (index: number) => void,
): ReactNode[] {
  return content.split(CITATION_TOKEN).map((part, i) => {
    const matched = /^\[(\d+)\]$/.exec(part);
    if (!matched) return part;

    const index = Number(matched[1]);
    const citation = citations.find((item) => item.index === index);
    if (!citation) return part;

    return (
      <button
        key={`${index}-${i}`}
        type="button"
        data-citation={index}
        onClick={() => onPick(index)}
        title={`${citation.docName} 第 ${citation.page} 页`}
        className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-wash px-1 align-middle text-[11px] font-medium text-brand-deep transition hover:bg-brand hover:text-white"
      >
        {index}
      </button>
    );
  });
}

/** 正则元字符转义，避免关键词里的括号等把正则打坏 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把原文里命中提问关键词的部分标黄，方便一眼看到答案出处。
 * @param text 原文片段
 * @param keywords 命中词（长度 ≥2）
 */
export function highlightTerms(text: string, keywords: string[]): ReactNode[] {
  if (!keywords.length) return [text];

  const pattern = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'gi');
  const lookup = new Set(keywords.map((word) => word.toLowerCase()));

  return text.split(pattern).map((part, i) =>
    lookup.has(part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-amber-100 px-0.5 text-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}