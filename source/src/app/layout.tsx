import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '文档问答 · 上传文档直接提问',
  description: '上传 Word / PDF / 文本，提问后拿到带原文页码引用的回答。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="font-sans text-ink antialiased">{children}</body>
    </html>
  );
}