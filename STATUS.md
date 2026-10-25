# 进度 · 20-simple-doc-qa

- 更新：2026-10-23
- 目标：精简版文档问答——上传 Word / PDF / 文本，提问后按原文回答并给出可点回的页码引用
- 当前：**已交付，自测全过**

## 本轮（2026-10-23）：从 18 瘦身成独立小工具

**为什么新建而不是改 18**：18 是参赛交付物（PPT、截图、110 项自测都基于它的完整功能），砍功能会让交付物对不上。这里新建 `20-simple-doc-qa`，复用 18 的解析内核，重写外壳。

**去掉的东西**
- 接口：`/api/summary`、`/api/minutes`、`/api/export`、`/api/debug/retrieve`、`/api/sample`
- 前端：摘要与纪要面板、检索调试面板、引用核对徽章、会话历史与多会话管理、示例文档入口、导出按钮
- 库：`lib/export`、`lib/embedding`（硅基流动向量适配器）、`chatJSON`/`extractJson`、`verifyNumbers`、`useSessions`
- 配置：只留 `DEEPSEEK_API_KEY`；不再需要 `SILICONFLOW_API_KEY` / `EMBEDDING_*` / 上传以外的任何开关
- 依赖：移除 `docx`（导出用）

**保留的东西**
- 解析层原样搬过来：`parse/pdf.ts`（按坐标重排）、`parse/ooxml.ts`（全量取文，含表格/文本框/页眉页脚/脚注批注）、`parse/doc.ts`（旧版 .doc）、`parse/sniff.ts`（按文件头定性）
- 检索改为纯 BM25 同步函数（`lib/bm25.ts` + `lib/retrieve.ts`），去掉向量与 RRF 融合
- 流式引用校验（`lib/verify.ts` 只留 `createCitationFilter`），越界编号仍会剔除
- 索引落盘与重启恢复（`lib/store.ts`）

**界面**：单页两栏——左边上传与文件列表，右边问答；回答里的 `[n]` 是可点按钮，点开右侧抽屉看原文并高亮命中词。

## 自测（都在生产构建上跑）

- `npx tsc --noEmit` 无错；`npm run build` 通过（路由只剩 `/`、`/api/ingest`、`/api/docs`、`/api/chat`）
- `node tmp/e2e.mjs` **4/4 通过**（真实模型 `deepseek-v4.1-flash`）：
  1. 自建 Word，答案在**表格**里 → 「服务器采购 128.5 万元 / 张伟」引第 1 页
  2. 同文档追问 → 「188.5 万元」「24 个月」引第 1 页
  3. 真实投稿要求 Word（WPS 存出的旧版 .doc，后缀却是 .docx）→ 「最多 5 个作品」「图像 2.8%」「视频 2 秒」全中
  4. 9 页示例 PDF → 「首年预算 2.52 万元」引第 5 页、「47 个馆」引第 1/4 页
- `node tmp/shot-ui.mjs`：上传→提问→点角标看原文全流程走通，**页面报错 0**，命中词高亮 7 处（截图见 `preview\`）
- `node tmp/shot-mobile.mjs`：390 宽无横向溢出、**0 个外部域名请求**（字体走系统栈）、页面报错 0
- 服务形态：`node server.mjs --prod --port 3111`（等价 `npm start`）首页 200、`/api/docs` 正常返回；`next dev` 另起端口也验过一次
- 中途踩坑：dev 与 prod 共用 `.next`，dev 覆盖了生产产物，导致在跑的 prod 服务全 500（`TypeError: dispatcher.getOwner is not a function`）；删 `.next` 重新 build 后恢复，已记进 `AGENTS.md`

## 下一步
- 无阻塞。可选：把 `LLM_CHAT_THINKING=off` 写进 `.env.local` 可降首字延迟；多栏排版 PDF 仍按逐行左右拼接取文（面向单栏办公文档，未修）。

## 已知事项
- 上传上限 20MB、单文档最多 600 个块；`.data` 目录即索引，删掉等于清库。
- `tmp/node_modules` 是借用 18 的 playwright-core 的 junction，与运行无关。