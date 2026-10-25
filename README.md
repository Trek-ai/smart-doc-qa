# 文档问答 · 精简版

上传 Word / PDF / 文本，直接提问；回答里每条结论都带来源编号，点角标就能看到那句话在原文哪一页。

只做这一件事，没有摘要、纪要、导出、多会话、检索调试面板等附加功能。

## 能力范围

- **能读**：PDF（按坐标重排，不会把标题拼成乱码）、Word 的新旧两种格式（`.docx` / `.doc`，含 WPS 把旧版存成 `.docx` 的情况）、纯文本 `.txt` / `.md`
- **文字位置不限**：Word 里的正文、**表格**、文本框、页眉页脚、脚注尾注、批注都会进索引
- **页码可信**：引用页码由解析层给出，不是「永远第 1 页」
- **检索**：本地 BM25，不需要额外密钥，不联网
- **回答**：只依据上传的内容作答；资料不足会直说「没有相关内容」，不编造
- **引用校验**：模型万一编出越界编号（比如只有 3 条却写 `[9]`），会直接从回答里剔除，不会留下点不动的死链

## 怎么跑

```powershell
cd F:\项目\DSH\20-simple-doc-qa\source
npm install
copy .env.example .env.local
# 打开 .env.local 填 DEEPSEEK_API_KEY（唯一必填项）
npm run dev            # 打开 http://localhost:3000
```

生产模式：

```powershell
npm run build
npm start              # 或 node server.mjs --prod --port 3111
```

- 索引落盘在 `source\.data\index.json`，重启自动恢复；想清空就删掉这个目录。
- 只想跑在别的端口：`npm run dev -- -p 3111`。
- `DEEPSEEK_MODEL` 要填**接口里的模型 id**（小写英文，如 `deepseek-v4.1-flash`），填控制台显示名会直接 404。

## 自测结果（2026-10-23，生产构建实测）

`node tmp/e2e.mjs` 四个用例全通过：

| 用例 | 结果 |
|---|---|
| 自建 Word（内容在**表格**里）问「服务器采购的金额和负责人」 | 答 128.5 万元 / 张伟，引用第 1 页 |
| 同一份 Word 追问合计与质保期 | 答 188.5 万元 / 24 个月，引用第 1 页 |
| 真实投稿要求 Word（WPS 存出的旧版 .doc，后缀写成 .docx） | 「每所高校最多 5 个作品」「图像 2.8%」「视频 2 秒」全中 |
| 9 页示例 PDF | 首年预算 2.52 万元引第 5 页、47 个馆引第 1/4 页 |

界面实拍（`node tmp/shot-ui.mjs`）：上传 → 问答 → 点角标看原文，无页面报错，命中词高亮 7 处。

## 目录

```
source\src\lib\parse\     解析层：pdf / ooxml(docx) / doc(旧版) / text，入口按文件头分流
source\src\lib\bm25.ts    本地检索
source\src\lib\retrieve.ts 取前 6 个相关块
source\src\lib\verify.ts  流式引用校验
source\src\app\api\       ingest / docs / chat 三个接口
source\src\components\Workspace.tsx  单页界面
tmp\                      自测脚本与夹具，不随应用发布
```