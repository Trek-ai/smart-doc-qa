# 20-simple-doc-qa · 接手先读

## 是什么
精简版文档问答工具（18「知源」的瘦身版）：上传 Word / PDF / 文本，直接提问；回答里每条结论都带来源编号，点角标看原文页码。
只做这一件事——**去掉**了摘要、会议纪要、导出 Word/Markdown、检索调试面板、检索评测、多会话历史、向量模型配置。

## 当前状态（2026-10-25）
- **2026-10-25 参赛打包完成**（AI协同办公工具赛道）：已推送公开仓库 https://github.com/Trek-ai/smart-doc-qa 。团队：辛嘉炜 / 罗勇添 / 林俊宁。材料：README（含「为什么需要密钥」对比论证 + 示例文档 samples/）、`deliverable/technical-documentation.pdf`（10 页）、`deliverable/demo-video.mp4`（5 分 10 秒 / 1080p）。
- **2026-10-25 默认零密钥（免费用模型）**：生成改成双通道——`LLM_PROVIDER=free`（默认，公开免密钥 OpenAI 兼容端点，零成本，约 30 秒/次限流）或 `deepseek`（自有密钥，`deepseek-chat` 锁定）。仓库内置 `source/.env`（不含任何密钥），评委 clone 后直接可用；页面 ⚙ 填自己的密钥即切换 DeepSeek。已实测两条通道均答对带引用。
- **2026-10-25 新增功能：页面内填密钥**：右上角 ⚙ 设置（API Key / 地址 / 模型，存 localStorage、随请求头 `x-ds-key` 等发送、不落服务端），服务端无密钥时退回 `.env.local`。评委零配置文件即可跑通（已实测：无 env 密钥启动，请求头带密钥完整答出）。README/技术文档已同步。
- **已交付并自测通过**（2026-10-23）：`tsc --noEmit` 无错、`npm run build` 通过、生产构建下 `tmp/e2e.mjs` 4/4 全过（自建表格 Word / 真实 WPS 旧版 .doc / 9 页 PDF），界面实拍无页面报错。
- 解析内核整体复用 18 的成果：PDF 按坐标重排、docx 自研 OOXML 全量取文（含**表格**、文本框、页眉页脚、脚注批注）、旧版 `.doc` 直读、入口按文件头分流。
- 检索只要本地 BM25，**不需要任何向量服务密钥**；唯一配置是 `DEEPSEEK_API_KEY`。
- 保留流式引用校验（越界编号直接剔除，不留死链）；去掉了数字对账徽章以保持界面干净。

## 入口与成品
- 上手与自测结果：`README.md`
- 进度：`STATUS.md`
- 截图：`preview\ui-qa.png`、`preview\ui-qa-citation.png`
- 源码：`source\`（`npm run dev` 起在 3000）

## 怎么跑
```powershell
cd F:\项目\DSH\20-simple-doc-qa\source
npm install
copy .env.example .env.local     # 只需填 DEEPSEEK_API_KEY
npm run dev                      # http://localhost:3000
```
- 生产：`npm run build` 后 `npm start`，或用 `node server.mjs --prod --port 3111`（不起子进程，受限沙箱也能跑）。
- 供应链受限环境里 `next dev` 可能因派生带管道的子进程报 `spawn EPERM`，改用 `node server.mjs`。
- 索引落盘 `source\.data\index.json`；清空就删该目录。

## 自测怎么做
```powershell
python tmp\make-table-docx.py tmp\table-check.docx   # 生成含表格的自测 Word
node tmp\e2e.mjs                                     # 上传+提问+核对答案与页码（真实模型）
node tmp\shot-ui.mjs preview\ui-qa.png               # 界面实拍 + 抓页面报错
```
- `tmp\node_modules` 是指向 `18-ai-doc-rag\tmp\node_modules` 的 junction，只为借用 playwright-core；删掉不影响应用。

## 踩过的坑（别再踩）
- **不要相信后缀**：真实遇到过 WPS 把 Word 97-2003 存成 `.docx`（文件头 `D0CF11E0`）。`parse/index.ts` 先看文件头再选解析器。
- **不要用只取正文段落的 Word 解析**：文本框、页眉页脚、脚注、表格都是正文级信息，漏了会静默丢内容。
- **不要用按内容流顺序拼字的 PDF 取文库**：真实 PDF 会把一行拆成乱序片段，必须按坐标重排。
- **推理模型不要用 `response_format: json_object`**（本版已无结构化输出，若日后加回：推理预算会被思维链吃光，正文为空）。
- `DEEPSEEK_MODEL` 填接口的模型 id，不是控制台显示名，否则 404 `Model not exist`。
- **别让 `next dev` 和 `next start` 同时跑同一个项目**：两者共用 `.next`，dev 会覆盖生产构建产物，正在跑的 prod 服务随即到处 500，报的是 `TypeError: dispatcher.getOwner is not a function`。要同时验两种模式，先 `Remove-Item .next -Recurse` 再重新 build。

## 架构要点（改代码前看这几条）
- 接口契约唯一真源：`source\src\lib\api.ts`，前后端都从这里取类型。
- 提示词集中在 `source\src\lib\prompts.ts`，不要在别处硬编码。
- `/api/chat` 是**先推 `citations` 再推 `token`**，这个顺序别改。
- 解析层对外只有 `parseDocument(name, buffer)`，返回 `{ pages, pageCount }`，页码从这一层带出来。
- 检索是同步纯函数 `retrieve(question, chunks, topK)`；`lib/bm25.ts` 同时导出 `queryKeywords` 供前端高亮，改动它要连带看 `lib/client/render.tsx`。

## 硬约束
- 路径与成品名用 ASCII；内容可用中文。
- 中间产物放 `tmp\`，预览放 `preview\`。
- 密钥只走 `.env.local`（已在 `.gitignore` 内），不要写进文档或代码。
- 不做线上部署形态；保持本地一条命令可跑。
- 保持「只做文档问答」这一条边界：加功能前先问是否需要。
- 交付前自测；交付后更新本文件「当前状态」和 `STATUS.md`。