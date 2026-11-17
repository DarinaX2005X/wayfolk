import { SILHOUETTES } from '../../../src/mind/types';
import { KINDS, drawKind } from '../../../src/theatre/silhouettes';

declare global {
  interface Window {
    __done?: boolean;
  }
}

const shot = new URLSearchParams(location.search).get('shot') ?? 'sheet';

async function sheet(): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 900;
  document.body.append(canvas);
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(720, 450, 50, 720, 450, 900);
  g.addColorStop(0, '#ffd9a0');
  g.addColorStop(1, '#d77a4e');
  c.fillStyle = g;
  c.fillRect(0, 0, 1440, 900);
  const cols = 12;
  const cell = 1440 / cols;
  const rows = Math.ceil(SILHOUETTES.length / cols);
  const ch = 900 / rows;
  SILHOUETTES.forEach((kind, i) => {
    const x = (i % cols) * cell;
    const y = Math.floor(i / cols) * ch;
    const info = KINDS[kind];
    const h = Math.min(ch - 26, (cell - 10) / info.aspect);
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(h * info.aspect) + 4;
    tmp.height = Math.ceil(h) + 4;
    const t = tmp.getContext('2d')!;
    drawKind(t, kind, 2, 2, h);
    if (!info.light) {
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = '#2b1712';
      t.fillRect(0, 0, tmp.width, tmp.height);
    }
    c.drawImage(tmp, x + (cell - tmp.width) / 2, y + 4);
    c.fillStyle = '#5a2e1c';
    c.font = '13px sans-serif';
    c.textAlign = 'center';
    c.fillText(kind, x + cell / 2, y + ch - 6);
  });
}

async function main(): Promise<void> {
  if (shot === 'sheet') await sheet();
  else {
    const mod = await import('./stage');
    await mod.stageShot(shot);
  }
  window.__done = true;
}
void main();
