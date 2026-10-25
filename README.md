# 知简 · 智能文档分析平台

> 参赛作品 · 赛道：AI协同办公工具（智能文档分析平台方向）

上传 Word / PDF / 文本，直接提问；回答里每条结论都带来源编号，点角标就能看到那句话在原文哪一页。
面向「几份办公文档、问几个问题」的真实场景，本地一条命令跑起来，只需要一个大模型密钥。

## 功能特性

- **能读**：PDF（按坐标重排，不会把标题拼成乱码）、Word 新旧两种格式（`.docx` / `.doc`，含 WPS 把旧版存成 `.docx` 的情况）、纯文本 `.txt` / `.md`
- **文字位置不限**：Word 里的正文、**表格**、文本框、页眉页脚、脚注尾注、批注都会进索引
- **页码可信**：引用页码由解析层给出，不是「永远第 1 页」；点角标打开原文抽屉，命中词高亮
- **检索**：本地 BM25，不需要向量数据库、不需要额外密钥、不联网
- **回答**：只依据上传的内容作答；资料不足会直说「没有相关内容」，不编造
- **引用校验**：模型万一编出越界编号（比如只有 3 条却写 `[9]`），流式实时剔除，不留点不动的死链

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | Next.js 15 + React 19 + TypeScript + Tailwind CSS 4 | 单页两栏工作台，SSE 流式渲染 |
| 解析 | pdfjs-dist + 自研 OOXML 提取器 + word-extractor | 按文件头分流，不信任后缀 |
| 检索 | 自研 BM25（`lib/bm25.ts`） | 同步纯函数，单文档语料 Recall@5 实测 100% |
| 生成 | DeepSeek API（deepseek-v4.1-flash） | 唯一外部依赖，流式输出 |
| 存储 | 进程内存 + JSON 落盘 | 重启自动恢复，无数据库 |

## 环境配置

- Node.js ≥ 20（实测 24）
- 一个 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 申请；任何 OpenAI 兼容接口均可）

```powershell
cd source
npm install
npm run dev            # 打开 http://localhost:3000，点右上角 ⚙ 填密钥即可
```

密钥两种填法任选：页面上 ⚙ 填（推荐，存浏览器本地，不用改任何文件）；或 `copy .env.example .env.local` 后在文件里填（开发者常驻用法）。

生产模式：

```powershell
npm run build
npm start              # 或 node server.mjs --prod --port 3111
```

环境变量模板见 `source/.env.example`：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 否 | 生成模型密钥；也可在页面 ⚙ 里填（页面填写优先） |
| `DEEPSEEK_BASE_URL` | 否 | 默认官方地址，兼容接口可改 |
| `DEEPSEEK_MODEL` | 否 | 填**接口模型 id**（如 `deepseek-v4.1-flash`），不是控制台显示名 |
| `LLM_CHAT_THINKING` | 否 | `off` 关闭思考模式，首字更快 |
| `DATA_DIR` | 否 | 索引落盘目录，默认 `source/.data` |

## 评审快速体验

仓库自带两份示例文档（`samples/` 目录），5 分钟可跑通全流程：

```powershell
git clone https://github.com/Trek-ai/smart-doc-qa
cd smart-doc-qa\source
npm install
npm run dev                     # 打开 http://localhost:3000
```

点右上角 **⚙**，粘贴 DeepSeek API Key 保存（API 地址默认 DeepSeek 官方，可改成任何 OpenAI 兼容接口）；
然后上传 `samples\sample-table.docx`，问「服务器采购这一项的金额和负责人分别是什么？」，
回答应出现 **128.5 万元 / 张伟** 并带角标 **[1]**；点角标可看到第 1 页原文与高亮命中词。
更多推荐问题见 `samples/README.md`。

> **关于密钥**：密钥只保存在评审自己的浏览器里，不写入服务器、不进代码仓库，也不需要改任何配置文件。如暂无密钥，可先观看 `deliverable/demo-video.mp4`，或联系团队获取临时评审密钥。为什么需要密钥、以及这和「直接用 DeepSeek 官网」有什么区别，见下一节。

## 常见问题

**Q：`npm start` 报 `Could not find a production build in the '.next' directory`？**
生产模式必须先构建：`npm run build` 之后再 `npm start`。另外 dev 与 prod **共用 `.next` 目录**，两者不要同时跑；从 dev 切到 prod 前先重新 `npm run build`。

**Q：上传了文档，但提问后回答一直不出来？**
说明还没配密钥：点页面右上角 **⚙** 填入 DeepSeek API Key（详见上一节）。

**Q：3000 端口被占用？**
`npm run dev -- -p 3111` 换端口；或先 `taskkill /F /IM node.exe` 清掉残留进程。

## 为什么需要密钥，而不是直接用 DeepSeek 官网

本系统的回答能力由 DeepSeek 大模型 API 提供，因此运行需要一个 API Key（平台免费申请、按量计费）。我们理解这给评审多了一步操作，所以先回答那个自然会有的问题——「直接去官网传文件问不就行了？」

| | DeepSeek 官网传文件问答 | 本系统 |
|---|---|---|
| 引用溯源 | 回答里提一句出处，**不能点回第几页核对** | 每条结论带角标，点击跳回原文页，命中词高亮 |
| 表格 / 文本框 / 页眉页脚 | 通用解析，表格内容经常丢失 | 自研 OOXML 提取器全量覆盖（实测见技术文档 5.3） |
| 乱序 PDF / 伪装后缀 | 按通用流程处理 | 坐标重排 + 文件头嗅探，专治真实办公文档的坑 |
| 防编造 | 依赖模型自觉 | 机制保证：检索无命中不调模型、越界引用实时剔除 |
| 数据隐私 | 整份文件上传云端 | 原文本机解析与索引，只有命中的少量片段发出 |
| 可扩展性 | 封闭服务 | 源码开放，可自行加 OCR、图谱检索等 |

一句话：**官网回答「文档说了什么」；本系统回答「文档说了什么、在第几页、能不能核对」**。密钥是调用大模型的通行成本（所有同类 RAG 应用都需要），换来的是上面这些官网给不了的可信与可控。

## 自测结果（2026-10-23，生产构建实测）

`node tmp/e2e.mjs` 四个用例全通过（真实模型）：

| 用例 | 结果 |
|---|---|
| 自建 Word（内容在**表格**里）问「服务器采购的金额和负责人」 | 答 128.5 万元 / 张伟，引用第 1 页 |
| 同一份 Word 追问合计与质保期 | 答 188.5 万元 / 24 个月，引用第 1 页 |
| 真实投稿要求 Word（WPS 存出的旧版 .doc，后缀写成 .docx） | 「每所高校最多 5 个作品」「图像 2.8%」「视频 2 秒」全中 |
| 9 页示例 PDF | 首年预算 2.52 万元引第 5 页、47 个馆引第 1/4 页 |

界面实拍（`node tmp/shot-ui.mjs`）：上传 → 问答 → 点角标看原文，无页面报错，命中词高亮 7 处；390px 移动端无横向溢出、0 外部域名请求。

## 目录结构

```
source/src/lib/parse/        解析层：pdf / ooxml(docx) / doc(旧版) / text，入口按文件头分流
source/src/lib/bm25.ts       本地 BM25 检索
source/src/lib/retrieve.ts   取前 6 个相关块
source/src/lib/verify.ts     流式引用校验
source/src/lib/prompts.ts    提示词集中管理
source/src/app/api/          ingest / docs / chat 三个接口
source/src/components/       单页工作台界面
tmp/                         自测脚本与夹具
deliverable/                 参赛材料：技术文档、演示视频
```

## 团队信息

| 姓名 | 分工 |
|---|---|
| 辛嘉炜 | 协作完成开发、技术文档与演示材料 |
| 罗勇添 | 协作完成开发、技术文档与演示材料 |
| 林俊宁 | 协作完成开发、技术文档与演示材料 |

## 许可

本项目代码仅供参赛评审使用。
