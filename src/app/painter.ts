/**
 * The painter paints your island: the painter (or whoever lives here with a brush) sets
 * up by the porch, looks at the island a while, and a real picture of it (a render of the
 * scene from where they stand) comes out in brush strokes on paper. It hangs by their
 * door, in a wooden frame, for as long as the visit lasts.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
} from '@iwsdk/core';
import { say as caption } from '../feel/captions';
import type { App } from './boot/world';
import { registerTest } from './debug';
import type { Guide } from './desk/guide';
import type { Modules } from './modules';

export const PAINT_LINES = {
  start: (name: string) => `${name} wants to paint the island. Sit still, it will not take long.`,
  done: 'Here. It is your island, the way it looks to me today.',
  nobody: 'Nobody with a brush lives here yet.',
} as const;

const W = 640;
const H = 400;

/** Turns a render into brush strokes on warm paper. */
export function paintify(src: Uint8ClampedArray, w: number, h: number, seed = 7): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  g.fillStyle = '#f4e6cc';
  g.fillRect(0, 0, w, h);
  let s = seed;
  const r = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const at = (x: number, y: number): [number, number, number] => {
    const i = (Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))) * 4;
    return [src[i], src[i + 1], src[i + 2]];
  };
  const lum = (c: [number, number, number]): number => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  g.lineCap = 'round';
  // Three passes, broad to fine, like a painter blocking in and then picking out.
  for (const [count, size, len] of [
    [2600, 9, 16],
    [5200, 5, 10],
    [6000, 2.5, 6],
  ] as const) {
    for (let i = 0; i < count; i += 1) {
      const x = r() * w;
      const y = r() * h;
      const c = at(x, y);
      // Strokes follow the edges: across the change in brightness.
      const gx = lum(at(x + 2, y)) - lum(at(x - 2, y));
      const gy = lum(at(x, y + 2)) - lum(at(x, y - 2));
      const a = Math.atan2(gy, gx) + Math.PI / 2 + (r() - 0.5) * 0.6;
      const l = len * (0.6 + r() * 0.8);
      // A little warmth and a little less detail than the eye sees.
      const q = (v: number): number => Math.min(255, Math.round((v * 0.92 + 18) / 16) * 16);
      g.strokeStyle = `rgba(${q(c[0] + 6)},${q(c[1])},${q(c[2] - 6)},${0.75 + r() * 0.2})`;
      g.lineWidth = size * (0.7 + r() * 0.6);
      g.beginPath();
      g.moveTo(x - Math.cos(a) * l * 0.5, y - Math.sin(a) * l * 0.5);
      g.lineTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5);
      g.stroke();
    }
  }
  // Paper showing at the edges.
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);
  v.addColorStop(0, 'rgba(244,230,204,0)');
  v.addColorStop(1, 'rgba(244,230,204,0.85)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  return out;
}

export function createPainter(app: App, mods: Modules, guide: Guide): { paint(): Promise<void> } {
  const { world, life, mind } = mods;
  const desk = (): boolean => app.store.mode.peek() === 'desk';
  const pace = (): number => Math.max(0.05, app.store.pace.peek());
  const wait = (ms: number): Promise<void> => new Promise((r) => app.clock.timers.set(r, ms * pace()));
  const within = <T>(p: Promise<T> | T, ms: number, fallback: T): Promise<T> => Promise.race([Promise.resolve(p), wait(ms).then(() => fallback)]).catch(() => fallback);
  const target = new WebGLRenderTarget(W, H);
  const cam = new PerspectiveCamera(55, W / H, 0.05, 2000);
  let hung: Group | null = null;
  let busy = false;

  const render = (from: Vector3, look: Vector3): HTMLCanvasElement => {
    cam.position.copy(from);
    cam.lookAt(look);
    cam.updateMatrixWorld(true);
    const r = app.world.renderer;
    const xrOn = r.xr.enabled;
    const prev = r.getRenderTarget();
    r.xr.enabled = false;
    r.setRenderTarget(target);
    r.clear();
    r.render(app.world.scene, cam);
    const px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(target, 0, 0, W, H, px);
    r.setRenderTarget(prev);
    r.xr.enabled = xrOn;
    const flipped = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y += 1) flipped.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    return paintify(flipped, W, H, Math.floor(Math.random() * 1e6));
  };

  const hang = (picture: HTMLCanvasElement, at: Vector3, face: Vector3): Group => {
    hung?.removeFromParent();
    const g = new Group();
    g.name = 'painting';
    const tex = new CanvasTexture(picture);
    tex.colorSpace = SRGBColorSpace;
    const canvasMesh = new Mesh(new PlaneGeometry(1.1, 0.69), new MeshBasicMaterial({ map: tex, toneMapped: false }));
    canvasMesh.position.z = 0.03;
    const frame = new Mesh(new BoxGeometry(1.24, 0.83, 0.05), new MeshLambertMaterial({ color: '#8a5a3b' }));
    g.add(frame, canvasMesh);
    g.position.copy(at);
    g.lookAt(face.x, at.y, face.z);
    app.roots.fx.add(g);
    hung = g;
    return g;
  };

  const paint = async (): Promise<void> => {
    if (busy) return;
    const list = (mind.state?.residents ?? []).filter((r) => life.objectOf?.(r.id));
    const painter = list.find((r) => r.trade === 'painter') ?? list.find((r) => r.trade === 'storyteller') ?? list[0];
    if (!painter) {
      caption({ source: 'Pip', text: PAINT_LINES.nobody });
      await within(Promise.resolve(life.pip.say(PAINT_LINES.nobody)), 5000, undefined);
      return;
    }
    busy = true;
    try {
      caption({ source: 'Pip', text: PAINT_LINES.start(painter.name) });
      void within(Promise.resolve(life.pip.say(PAINT_LINES.start(painter.name))), 6000, undefined);
      // By the porch, looking out over the island.
      const seat = (world.seat as { meet?: Vector3 }).meet;
      const spot = seat?.isVector3 ? world.root.localToWorld(seat.clone()).add(new Vector3(1.4, 0, 0.3)) : new Vector3(1.4, 0, -1.6);
      await within(Promise.resolve(life.walkTo(painter.id, spot, { speed: 1.6 })), 9000, undefined);
      const centre = world.root.localToWorld(new Vector3(-0.5, 0, -12));
      life.face?.(painter.id, centre);
      life.emote(painter.id, 'work');
      if (desk()) guide.frame(guide.of(() => life.objectOf?.(painter.id), 0.5));
      await wait(6000);
      const eye = spot.clone().add(new Vector3(0, 1.6, 0.8));
      const picture = render(eye, centre.clone().add(new Vector3(0, 1.2, 0)));
      // It hangs by the painter's door, or beside them when they have no house.
      const house = (world as { house?: (id: string) => { door?: Vector3 } | undefined }).house?.(painter.houseId ?? '');
      const doorAt = house?.door ? world.root.localToWorld(house.door.clone()).add(new Vector3(0, 1.55, 0)) : spot.clone().add(new Vector3(0.8, 1.3, 0));
      const head = app.world.camera.getWorldPosition(new Vector3());
      const g = hang(picture, doorAt, head);
      if (desk()) guide.frame(() => g.position, { lift: 0 });
      life.face?.(painter.id);
      life.emote(painter.id, 'happy');
      caption({ source: painter.name, text: PAINT_LINES.done });
      await within(life.say(painter.id, PAINT_LINES.done, { name: painter.name }), 7000, undefined);
      await wait(2500);
      if (desk()) guide.frame(null);
    } finally {
      busy = false;
    }
  };

  registerTest('paint', () => paint());
  return { paint };
}
