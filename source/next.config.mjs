/**
 * Next.js 配置。
 * 本地运行只需要一条：pdfjs-dist / mammoth 是原生 + ESM 依赖，不参与打包，留在 Node 侧加载。
 * 用 .mjs 而不是 .ts，避免启动时再去 transpile 配置文件。
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdfjs-dist', 'mammoth'],
};

export default nextConfig;