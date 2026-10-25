# 进度 · 20-simple-doc-qa

- 更新：2026-10-25
- 目标：精简版文档问答——上传 Word / PDF / 文本，提问后按原文回答并给出可点回的页码引用
- 当前：**已交付；2026-10-25 追加参赛材料打包**

## 2026-10-25：参赛材料（AI协同办公工具赛道）

- 建 git 仓库（main 分支），分批提交：初始导入 → README → 技术文档 → 演示视频
- README 补全参赛四要素：项目介绍 / 技术栈表 / 环境变量模板表 / 团队信息（辛嘉炜、罗勇添、林俊宁）
- 技术文档 `deliverable/technical-documentation.pdf`：10 页，覆盖项目概述/需求分析/架构设计/AI 技术方案/核心实现/测试部署/总结展望 + 创新点（技术 5 条 + 应用 3 条）
- 演示视频：5 分钟自动合成版（playwright 实拍 + SAPI 配音 + ffmpeg 1080p），进 `deliverable/`
- 按需求移除 DeepSeek 方向：`lib/deepseek.ts` 删除、新增 `lib/llm.ts`；`config.ts` 只留免密钥通道；页面设置弹窗与密钥字段全部移除；README/技术文档/PDF 同步更新（免密钥、零配置）
- 最终形态：生成通道只有免密钥免费模型一种（`FREE_BASE_URL` / `FREE_MODEL` 可换端点），仓库内置 `source/.env`，评委 clone 后零配置可用

- 新增「按范围提问」：文档编号 + 点选/Ctrl 多选 + `@编号` 指定，检索按 docIds 过滤；实测范围外正确拒答，界面 0 报错；截图 `preview/ui-scope-select.png`、`ui-scope-mention.png`

- 演示视频重做：HyperFrames 合成（深色高端风格 + 常驻中文字幕 + 8 段配音），5 分 29 秒 / 1080p30；`npm run check` 0 error、35/35 对比度通过；工程留在 `tmp/zhijian-video/` 可复现

## 历史（2026-10-23）

从 18「知源」瘦身成独立小工具：去掉摘要/纪要/导出/检索调试/评测/多会话/向量配置，保留解析内核 + BM25 + 流式引用校验。自测 4/4 通过，详见 git log 与 README。

## 已知事项
- 上传上限 20MB、单文档最多 600 个块；`.data` 目录即索引，删掉等于清库。
- `tmp/node_modules` 是借用 18 的 playwright-core 的 junction，与运行无关。
- 多栏 PDF 按逐行左右拼接取文（面向单栏办公文档）；扫描件不支持（明确报错）。
