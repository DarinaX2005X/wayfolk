/**
 * A plain Vite server for the render bench of the world kit (tests/kit/world/render/):
 * no IWSDK plugin, no managed browser, its own port. `node tests/kit/world/render/shoot.mjs`
 * starts it, takes the frames into tests/kit/world/out/ and stops it.
 */
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(__dirname, '../../../..'),
  server: { port: 8093, strictPort: true, host: '127.0.0.1' },
  resolve: { dedupe: ['three', '@pmndrs/uikit', '@preact/signals-core'] },
  optimizeDeps: { exclude: ['@babylonjs/havok'], esbuildOptions: { target: 'esnext' } },
  esbuild: { target: 'esnext' },
  logLevel: 'warn',
});
