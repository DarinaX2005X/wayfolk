/**
 * High five. In the headset, when one person's palm meets the friend's palm with a little
 * speed, both islands see it at once: Pip and the working birds burst into a spiral of
 * birds round the meeting hands, sparks swirl up, a warm chord rings, and a postcard of
 * the two of them on the island is taken from a few steps away. In a page there are no
 * hands, so a click on the friend holds a mitten up for them; their click (or their real
 * hand meeting the mitten) makes the high five.
 */
import {
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from '@iwsdk/core';
import { Avatar } from '../live/avatar';
import type { HandOut, PoseOut } from '../live/interp';
import { blob, join, paint, place } from '../world/geo';
import type { Workers } from './birds';
import type { Ctx } from './context';
import { Motes } from './duet';
import { FIVE_COOLDOWN_MS, isHighFive, palmFrom } from './plan';

export const FIVE_LINES = {
  offered: (friend: string) => `Your hand is up. Wait for ${friend} to meet it.`,
  theirs: (friend: string) => `${friend} is holding up a hand. Give them a high five.`,
  after: ['That one went all the way to the clouds.', 'The birds felt that one.', 'Again sometime. The flock liked it.'],
} as const;

// Fingertips of a relaxed open left hand in its wrist frame (WebXR: −z toward the fingers).
const TIPS_L: [number, number, number][] = [
  [0.087, -0.04, -0.101],
  [0.035, -0.022, -0.178],
  [-0.01, -0.016, -0.188],
  [-0.035, -0.013, -0.176],
  [-0.062, -0.022, -0.144],
];

/** An open hand held up at `palm`, facing `toward` (island frame), into a HandOut. */
export function raisedHand(palm: Vector3, toward: Vector3, side: 'left' | 'right', out: HandOut): void {
  const face = toward.clone().sub(palm).setY(0).normalize();
  const z = new Vector3(0, -1, 0); // fingers up
  const y = face.clone().negate(); // back of the hand away from the friend
  const x = new Vector3().crossVectors(y, z).normalize();
  const m = side === 'left' ? 1 : -1;
  const wrist = palm.clone().addScaledVector(z, 0.07);
  out.present = true;
  out.controller = false;
  out.wrist = [wrist.x, wrist.y, wrist.z];
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  out.quat = [q.x, q.y, q.z, q.w];
  TIPS_L.forEach((t, i) => {
    const p = wrist.clone().addScaledVector(x, t[0] * m).addScaledVector(y, t[1]).addScaledVector(z, t[2]);
    out.tips[i * 3] = p.x;
    out.tips[i * 3 + 1] = p.y;
    out.tips[i * 3 + 2] = p.z;
  });
}

/** A felt mitten held up, in someone's colour. */
function mitten(color: string): Mesh {
  const c = new Color(color).lerp(new Color('#fff3e2'), 0.25);
  const cuff = paint(place(blob(0.03, 1, 7, 0.03, 1), [0, -0.085, 0], [0, 0, 0], [1.3, 0.6, 1.1]), new Color('#fff3e2'), { smooth: true, shade: 0.1 }, true);
  const g = join([
    paint(place(blob(0.055, 2, 3, 0.03, 1), [0, 0, 0], [0, 0, 0], [1, 1.25, 0.55]), c, { smooth: true, shade: 0.2 }, true),
    paint(place(blob(0.024, 1, 5, 0.03, 1), [0.055, -0.02, 0.0], [0, 0, -0.6], [0.9, 1.5, 0.9]), c, { smooth: true, shade: 0.2 }, true),
    cuff,
  ]);
  const m = new Mesh(g, new MeshLambertMaterial({ vertexColors: true }));
  m.name = 'together:mitten';
  m.userData.together = { kind: 'mitten' };
  m.userData.cuff = cuff.getAttribute('position').count;
  return m;
}

export class Five {
  readonly group = new Group();
  private lastAt = -1e9;
  private readonly prev = new Map<string, number>();
  private offerMine = false;
  private offerMineUntil = 0;
  private theirsUntil = 0;
  private readonly theirMitten: Mesh;
  private spiral: { at: Vector3; t: number } | null = null;
  private readonly motes = new Motes(120);
  private readonly v = new Vector3();
  private readonly warm = new Color('#ffd38a');
  private readonly gold = new Color('#ffb347');
  private readonly rose = new Color('#ff9d8a');
  /** The last postcard image (data URL), for the app or a test. */
  lastPostcard: string | null = null;
  onPostcard: ((image: string) => void) | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly workers: Workers,
    private readonly gfx: { renderer?: WebGLRenderer | null; scene?: Scene | Object3D | null },
  ) {
    this.group.name = 'together:five';
    ctx.root.add(this.group);
    this.theirMitten = mitten('#3f9e98');
    this.theirMitten.visible = false;
    this.group.add(this.theirMitten);
    this.group.add(this.motes.points);
  }

  get offered(): boolean {
    return this.offerMine && this.ctx.now() < this.offerMineUntil;
  }

  get theirs(): boolean {
    return this.ctx.now() < this.theirsUntil;
  }

  /** The friend's hand went up (or down) in a page. */
  friendOffer(on: boolean, color: string): void {
    this.theirsUntil = on ? this.ctx.now() + 9000 : 0;
    (this.theirMitten.material as MeshLambertMaterial).color.set(0xffffff);
    paintMitten(this.theirMitten, color);
    if (on) this.ctx.say(FIVE_LINES.theirs(this.ctx.friend()?.name ?? 'Your friend'));
  }

  /** A click on the friend (a page): answer their raised hand, or raise mine. Returns where it happened when it was a high five. */
  offer(): Vector3 | null {
    if (this.theirs) {
      const at = this.mittenPoint();
      return at;
    }
    this.offerMine = true;
    this.offerMineUntil = this.ctx.now() + 9000;
    this.ctx.say(FIVE_LINES.offered(this.ctx.friend()?.name ?? 'your friend'));
    return null;
  }

  dropOffer(): void {
    this.offerMine = false;
  }

  /** Where the friend's mitten (or their head side) is, island frame. */
  private mittenPoint(): Vector3 {
    return this.theirMitten.visible ? this.theirMitten.position.clone() : this.friendHead()?.add(new Vector3(0, -0.05, 0)) ?? new Vector3();
  }

  private friendPose(): PoseOut | null {
    const root = this.ctx.friendAvatar();
    const a = root?.userData.avatar as Avatar | undefined;
    return a && root?.visible ? a.pose : null;
  }

  private friendHead(): Vector3 | null {
    const p = this.friendPose();
    return p ? new Vector3(p.pos[0], p.pos[1], p.pos[2]) : null;
  }

  /** Checks my palms against the friend's palms (or their mitten); returns the meeting point. */
  detect(dt: number, palms: { id: string; p: Vector3 }[]): Vector3 | null {
    if (this.ctx.now() - this.lastAt < FIVE_COOLDOWN_MS) return null;
    const pose = this.friendPose();
    const theirs: { id: string; p: Vector3 }[] = [];
    if (pose) {
      for (const side of ['left', 'right'] as const) {
        const h = pose[side];
        if (h.present) theirs.push({ id: side, p: new Vector3(...palmFrom(h.wrist, h.controller ? [] : h.tips)) });
      }
    }
    if (this.theirs && this.theirMitten.visible) theirs.push({ id: 'mitten', p: this.theirMitten.position.clone() });
    let hit: Vector3 | null = null;
    for (const a of palms)
      for (const b of theirs) {
        const key = `${a.id}:${b.id}`;
        const d = a.p.distanceTo(b.p);
        const before = this.prev.get(key) ?? d;
        this.prev.set(key, d);
        const speed = (before - d) / Math.max(1e-3, dt);
        if (!hit && (isHighFive(d, speed) || (b.id === 'mitten' && d < 0.16))) hit = a.p.clone().lerp(b.p, 0.5);
      }
    return hit;
  }

  /** The high five happened at `at` (island frame). */
  fire(at: Vector3): boolean {
    const now = this.ctx.now();
    if (now - this.lastAt < FIVE_COOLDOWN_MS) return false;
    this.lastAt = now;
    this.offerMine = false;
    this.theirsUntil = 0;
    const world = this.ctx.root.localToWorld(at.clone());
    this.ctx.sound.fiveChord(world);
    this.spiral = { at: at.clone(), t: 0 };
    this.ctx.life?.pip?.emote?.('excited');
    this.ctx.life?.flockCircle?.(world.clone().add(new Vector3(0, 2.2, 0)), 1.8);
    // The working birds come out of nowhere round the hands and spiral up.
    this.workers.show(4);
    this.workers.all.forEach((w, k) => {
      w.busy = true;
      w.bird.mode = 'carry';
      const a0 = (k / this.workers.all.length) * Math.PI * 2;
      w.bird.pos.copy(at).add(new Vector3(Math.cos(a0) * 0.5, 0.05, Math.sin(a0) * 0.5));
      w.bird.vel.set(0, 0, 0);
      const start = this.ctx.now();
      w.bird.goalFn = (out) => {
        const t = (this.ctx.now() - start) / 1000;
        const a = t * 4.2 + (k / this.workers.all.length) * Math.PI * 2;
        const r = 0.45 + t * 0.7;
        out.set(at.x + Math.cos(a) * r, at.y + 0.1 + t * 0.75, at.z + Math.sin(a) * r);
        return true;
      };
    });
    setTimeout(() => {
      for (const w of this.workers.all) this.workers.release(w);
      this.ctx.life?.flockCircle?.(null);
    }, 2800);
    setTimeout(() => this.ctx.say(FIVE_LINES.after[Math.floor(Math.random() * FIVE_LINES.after.length)]), 1600);
    // the picture when the birds have risen round them, both still beaming
    setTimeout(() => this.postcard(at), 1300);
    return true;
  }

  /** A picture of the two of them, from a few steps away, with the island behind. */
  postcard(at: Vector3): string | null {
    const r = this.gfx.renderer;
    const scene = this.gfx.scene;
    if (!r || !scene || typeof document === 'undefined') return null;
    const W = 640;
    const H = 400;
    const me = this.ctx.me();
    const myHead = this.ctx.head(new Vector3());
    const theirHead = this.friendHead() ?? at.clone().add(at.clone().sub(myHead).setY(0).normalize().multiplyScalar(0.3)).setY(myHead.y);
    // My own felt self stands in for me in the picture (the friend's is already there).
    const self = new Avatar({ name: me.name, color: me.color });
    const look = theirHead.clone().sub(myHead).setY(0).normalize();
    const yaw = Math.atan2(-look.x, -look.z);
    self.pose.pos = [myHead.x, myHead.y, myHead.z];
    const q = new Group().quaternion.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    self.pose.quat = [q.x, q.y, q.z, q.w];
    raisedHand(at.clone().addScaledVector(look, -0.03), theirHead, 'right', self.pose.right);
    self.ground = (x, z) => this.ctx.ground(x, z);
    this.ctx.root.add(self.root);
    self.setActive(true);
    for (let i = 0; i < 40; i++) self.update(0.05, this.ctx.camera);
    const pose = this.friendPose();
    // A friend in a page has no hands: theirs goes up for the picture too.
    const restore = pose && !pose.right.present ? (raisedHand(at.clone().addScaledVector(look, 0.03), myHead, 'right', pose.right), () => (pose.right.present = false)) : null;
    const mid = myHead.clone().lerp(theirHead, 0.5);
    const across = theirHead.clone().sub(myHead).setY(0).normalize();
    const side = new Vector3(-across.z, 0, across.x);
    // The camera stands on the side away from the island's middle, so the island is behind them.
    const toMiddle = new Vector3(-0.5, 0, -12).sub(mid).setY(0);
    if (side.dot(toMiddle) > 0) side.negate();
    const cam = new PerspectiveCamera(48, W / H, 0.05, 1600);
    const eye = mid.clone().addScaledVector(side, 2.7).add(new Vector3(0, 0.05, 0));
    cam.position.copy(this.ctx.root.localToWorld(eye.clone()));
    cam.lookAt(this.ctx.root.localToWorld(mid.clone().add(new Vector3(0, 0.12, 0))));
    cam.updateMatrixWorld(true);
    const target = new WebGLRenderTarget(W, H, { colorSpace: SRGBColorSpace });
    const xrOn = r.xr.enabled;
    const prev = r.getRenderTarget();
    let url: string | null = null;
    try {
      r.xr.enabled = false;
      r.setRenderTarget(target);
      r.clear();
      r.render(scene as Scene, cam);
      const px = new Uint8Array(W * H * 4);
      r.readRenderTargetPixels(target, 0, 0, W, H, px);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      const img = g.createImageData(W, H);
      for (let y = 0; y < H; y += 1) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      g.putImageData(img, 0, 0);
      url = c.toDataURL('image/jpeg', 0.88);
    } catch (error) {
      console.warn('[together] the postcard was not taken', error);
    } finally {
      r.setRenderTarget(prev);
      r.xr.enabled = xrOn;
      target.dispose();
      self.dispose();
      self.root.removeFromParent();
      restore?.();
    }
    if (url) {
      this.lastPostcard = url;
      this.onPostcard?.(url);
    }
    return url;
  }

  update(dt: number): void {
    // the friend's mitten, up beside their head while they offer
    const head = this.friendHead();
    const show = this.theirs && head !== null;
    this.theirMitten.visible = show;
    if (show && head) {
      const me = this.ctx.head(new Vector3());
      const to = me.clone().sub(head).setY(0).normalize();
      const side = new Vector3(-to.z, 0, to.x);
      this.theirMitten.position.copy(head).addScaledVector(side, -0.26).addScaledVector(to, 0.12).add(new Vector3(0, 0.02 + Math.sin(this.ctx.now() / 180) * 0.015, 0));
      this.theirMitten.rotation.y = Math.atan2(to.x, to.z);
      this.theirMitten.rotation.z = Math.sin(this.ctx.now() / 260) * 0.15;
    }
    if (this.offerMine && this.ctx.now() > this.offerMineUntil) this.offerMine = false;
    if (this.spiral) {
      // sparks swirl up round the hands in three arms
      const sp = this.spiral;
      sp.t += dt;
      if (sp.t < 1.5)
        for (let k = 0; k < 3; k++) {
          const a = sp.t * 9 + (k / 3) * Math.PI * 2;
          const r = 0.08 + sp.t * 0.55;
          this.v.set(sp.at.x + Math.cos(a) * r, sp.at.y + sp.t * 1.1, sp.at.z + Math.sin(a) * r);
          this.motes.emit(this.v, k === 0 ? this.warm : k === 1 ? this.gold : this.rose, 1, 0.04);
        }
      if (sp.t > 3.5) this.spiral = null;
    }
    this.motes.update(dt);
  }

  targets(): Object3D[] {
    return this.theirMitten.visible ? [this.theirMitten] : [];
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

function paintMitten(m: Mesh, color: string): void {
  const c = new Color(color).lerp(new Color('#fff3e2'), 0.25);
  const col = m.geometry.getAttribute('color');
  const n = col.count;
  // the cuff (last part) stays cream
  const cuffFrom = n - (m.userData.cuff as number | undefined ?? Math.floor(n / 5));
  for (let i = 0; i < cuffFrom; i++) col.setXYZ(i, c.r, c.g, c.b);
  col.needsUpdate = true;
}
