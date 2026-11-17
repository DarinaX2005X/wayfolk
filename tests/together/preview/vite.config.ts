// Preview of doing things together: its own Vite on port 5185 (the app owns the main dev server).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '../../..');

export default defineConfig({
  root: here,
  publicDir: path.join(project, 'public'),
  server: { port: 5185, strictPort: true, host: '127.0.0.1', fs: { allow: [project] } },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three'], esbuildOptions: { target: 'esnext' } },
  esbuild: { target: 'esnext' },
  logLevel: 'warn',
});
