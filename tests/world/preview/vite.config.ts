// Preview of the world module alone: npx vite --config tests/world/preview/vite.config.ts
import path from 'node:path';
import { defineConfig } from 'vite';

const ROOT = path.resolve(__dirname, '../../..');

export default defineConfig({
  root: __dirname,
  publicDir: path.join(ROOT, 'public'),
  server: { port: 5181, strictPort: true, host: '127.0.0.1', fs: { allow: [ROOT] } },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three'], esbuildOptions: { target: 'esnext' } },
  esbuild: { target: 'esnext' },
  logLevel: 'warn',
});
