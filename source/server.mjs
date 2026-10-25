/**
 * 本地开发用启动脚本。
 * 直接以编程方式启动 Next（dev 或 start），不起独立的子进程，
 * 适合在受限沙箱或 CI 里跑，普通使用请仍然用 npm run dev / npm start。
 *
 * 用法：node server.mjs [--port 3000] [--prod]
 */

import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const next = require('next');

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const prod = args.includes('--prod');
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : Number(process.env.PORT || 3000);

const app = next({ dev: !prod, dir });
const handle = app.getRequestHandler();

await app.prepare();

http
  .createServer((req, res) => handle(req, res))
  .listen(port, () => {
    console.log(`[zhiyuan] listening on http://127.0.0.1:${port} (${prod ? 'production' : 'development'})`);
  });