import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { devApi } from './tools/dev-api/plugin';

// Vitest loads this file too. The IWSDK plugin launches the managed browser and the
// emulator bridge, which unit tests must not start, so it is left out under Vitest.
const underTest = Boolean(process.env.VITEST);
// `npm run xr:prod` builds dist/ with VITE_GW_TEST=1 (debug hooks on) and serves it through
// the managed dev server with GW_SERVE_DIST=1 (scripts/xr-prod.mjs says why the build
// keeps the DEV branches).
const serveDist = process.env.GW_SERVE_DIST === '1';

const DIST = path.resolve(__dirname, 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the files of dist/ instead of the sources (GW_SERVE_DIST=1). Addresses of the
 * dev server itself (/@vite, /@iwsdk, /@id, /__*, /node_modules) and /api/* pass through,
 * so the emulator bridge and the dev API keep working; an address without a file is a
 * route of the app and gets dist/index.html, as vercel.json rewrites it on the deployment.
 */
function distServer(): Plugin {
  return {
    name: 'groundwork:serve-dist',
    apply: 'serve',
    configureServer(server) {
      if (!existsSync(path.join(DIST, 'index.html'))) {
        throw new Error('GW_SERVE_DIST=1 needs a build in dist/: run the build first (npm run xr:prod does)');
      }
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dist.local').pathname);
        if (/^\/(api|@|__|node_modules)(\/|$)/.test(pathname) || pathname.startsWith('/@')) return next();
        let file = path.join(DIST, pathname);
        if (!file.startsWith(DIST)) return next();
        const isFile = existsSync(file) && statSync(file).isFile();
        if (!isFile) {
          if (path.extname(pathname)) return next();
          file = path.join(DIST, 'index.html');
        }
        res.statusCode = 200;
        res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
        res.setHeader('cache-control', 'no-store');
        if (req.method === 'HEAD') return res.end();
        if (path.extname(file) === '.html') {
          // The page goes through the dev server's HTML transform, so the IWSDK plugin adds
          // the client of its command bridge, exactly as it does for the sources.
          void server
            .transformIndexHtml(req.url ?? '/', readFileSync(file, 'utf8'))
            .then((html) => res.end(html))
            .catch(next);
          return;
        }
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: underTest
    ? []
    : [iwsdkDev(), devApi(), ...(serveDist ? [distServer()] : [])],
  // No error overlay: module packages land in parallel, and a half-written module must not cover the frames.
  // The module packages (world, life, mind, live) are built in parallel and preview their
  // work on their own ports; their edits must not reload the app page in the middle of a
  // scenario. Restart the dev server to pick them up. WF_WATCH_ALL=1 watches everything.
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
    hmr: { overlay: false },
    watch: process.env.WF_WATCH_ALL === '1' ? {} : { ignored: ['**/src/world/**', '**/src/life/**', '**/src/mind/**', '**/src/live/**', '**/public/assets/**', '**/content/**', '**/api/**', '**/relay/**', '**/tests/**/out/**'] },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks.
  resolve: {
    dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide', '@preact/signals-core'],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide', '@drawcall/uikitml'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  // Absolute base: the app is routed by path (/app, /w/<world>, /x/<code>), so a relative
  // base would resolve bundles against the route instead of the origin.
  base: '/',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'content/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/xr/out/**', 'tests/web/out/**'],
  },
});
