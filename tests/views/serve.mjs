#!/usr/bin/env node
/**
 * Serves a built copy of the app for frames and browser checks that must not be
 * reloaded by edits on the dev server: every address without a file gets index.html,
 * as vercel.json rewrites it; /api/* goes on to the dev server when it runs.
 *
 *   VITE_GW_TEST=1 npx vite build --outDir ../gw-dist && node tests/views/serve.mjs ../gw-dist 8095
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 8095);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain' };

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname.startsWith('/api/')) {
      const up = https.request({ host: 'localhost', port: 8081, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:8081' }, rejectUnauthorized: false }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end('{"error":"offline"}');
      });
      req.pipe(up);
      return;
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      if (path.extname(url.pathname)) {
        res.writeHead(404);
        return res.end();
      }
      file = path.join(root, 'index.html');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${root} at http://127.0.0.1:${port}`));
