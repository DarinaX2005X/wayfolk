/**
 * The postcard (PROJECT «Фишки» 11): frame the island with both hands (thumbs and index
 * fingers as the corners of a rectangle) and hold for a moment; a shutter, a snapshot of
 * the view, and a paper card with the picture and a QR code appears in the hand. The QR
 * opens /p/<island> on a phone: a 3D view of the island in the browser.
 *
 * The snapshot renders the scene once more from the head into a small target, outside
 * the XR views, and reads it back.
 */
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
} from '@iwsdk/core';
import { sound } from '../feel/sound';
import { FONT } from '../kit/ui/bubble';
import { drawQr, encodeQr } from '../kit/ui/qr';
import type { App } from './boot/world';
import { registerDebug, registerTest } from './debug';
import { shareOrigin } from './origin';
import type { Hands } from './hands/hands';
import type { MindPort } from './ports';

export type Postcard = {
  take(): Promise<{ url: string; image: string } | null>;
  /** Shows a card with a QR code for any link (the friend invite uses it too). */
  showCard(title: string, url: string, image?: string): void;
  hide(): void;
  enable(on: boolean): void;
};

const W = 640;
const H = 400;

/** The frame gesture: both hands in an L, apart, in front of the eyes (pure; tested). */
export function isFrameGesture(g: {
  leftThumbIndex: number;
  rightThumbIndex: number;
  handsApart: number;
  ahead: number;
  heightBelowEyes: number;
}): boolean {
  return (
    g.leftThumbIndex > 0.06 &&
    g.rightThumbIndex > 0.06 &&
    g.handsApart > 0.16 &&
    g.handsApart < 0.75 &&
    g.ahead > 0.2 &&
    g.heightBelowEyes < 0.35 &&
    g.heightBelowEyes > -0.3
  );
}

export function islandLink(id: string): string {
  return `${shareOrigin()}/p/${encodeURIComponent(id)}`;
}

export function createPostcard(app: App, hands: Hands, mind: MindPort): Postcard {
  const { world } = app;
  const target = new WebGLRenderTarget(W, H);
  const snapCam = new PerspectiveCamera(50, W / H, 0.05, 2000);
  const head = new Vector3();
  const mid = new Vector3();
  let card: Mesh | null = null;
  let enabled = false;
  let holdSince = -1;
  let busy = false;

  const snapshot = (): string => {
    const cam = world.camera;
    cam.updateWorldMatrix(true, false);
    snapCam.position.setFromMatrixPosition(cam.matrixWorld);
    snapCam.quaternion.setFromRotationMatrix(cam.matrixWorld);
    snapCam.updateMatrixWorld(true);
    const r = world.renderer;
    const xrOn = r.xr.enabled;
    const prev = r.getRenderTarget();
    r.xr.enabled = false;
    r.setRenderTarget(target);
    r.clear();
    r.render(world.scene, snapCam);
    const px = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(target, 0, 0, W, H, px);
    r.setRenderTarget(prev);
    r.xr.enabled = xrOn;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y += 1) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  const drawCard = (title: string, url: string, image?: string): Promise<HTMLCanvasElement> =>
    new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 640;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff7ea';
      g.fillRect(0, 0, 1024, 640);
      g.strokeStyle = '#e8c9a0';
      g.lineWidth = 8;
      g.strokeRect(4, 4, 1016, 632);
      const finish = (): void => {
        const qr = encodeQr(url);
        const px = Math.floor(260 / (qr.size + 8));
        drawQr(g, qr, 1024 - 40 - (qr.size + 8) * px, 640 - 60 - (qr.size + 8) * px, px);
        g.fillStyle = '#3a2c22';
        g.font = `700 40px ${FONT}`;
        g.textBaseline = 'top';
        g.fillText(title, 40, image ? 500 : 60);
        g.font = `400 26px ${FONT}`;
        g.fillStyle = '#7a5a40';
        g.fillText(url.replace(/^https?:\/\//, ''), 40, image ? 556 : 120);
        resolve(c);
      };
      if (image) {
        const img = new Image();
        img.onload = () => {
          g.drawImage(img, 40, 40, 640, 400);
          finish();
        };
        img.onerror = finish;
        img.src = image;
      } else finish();
    });

  const place = (mesh: Mesh): void => {
    const cam = world.camera;
    cam.updateWorldMatrix(true, false);
    mesh.position.set(0, -0.12, -0.42).applyMatrix4(cam.matrixWorld);
    cam.getWorldPosition(head);
    mesh.lookAt(head);
  };

  const postcard: Postcard = {
    async take() {
      if (busy) return null;
      busy = true;
      try {
        sound.play('flip');
        const image = snapshot();
        let id = mind.state?.id ?? 'island';
        try {
          const published = await mind.publish?.();
          if (typeof published === 'string') id = published;
          else if (published && typeof (published as { id?: unknown }).id === 'string') id = (published as { id: string }).id;
        } catch (error) {
          console.warn('[wf] the island could not be published; the link opens the local copy', error);
        }
        const url = islandLink(id);
        app.store.postcard.value = { url, image };
        postcard.showCard('A postcard from your island', url, image);
        return { url, image };
      } finally {
        busy = false;
      }
    },
    showCard(title, url, image) {
      // A page has its own card with the link and the picture; the card in the air is for a headset.
      if (app.store.mode.peek() === 'desk') return;
      void drawCard(title, url, image).then((canvas) => {
        postcard.hide();
        const tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        const mesh = new Mesh(new PlaneGeometry(0.32, 0.2), new MeshBasicMaterial({ map: tex, side: DoubleSide, toneMapped: false }));
        mesh.name = 'postcard';
        mesh.renderOrder = 30;
        place(mesh);
        app.roots.fx.add(mesh);
        card = mesh;
        sound.play('paper');
        // It does not stay forever, and never comes along to another place.
        const shown = mesh;
        app.clock.timers.set(() => {
          if (card === shown) postcard.hide();
        }, 25000);
      });
    },
    hide() {
      if (!card) return;
      const m = card.material as MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
      card.geometry.dispose();
      card.removeFromParent();
      card = null;
    },
    enable(on) {
      enabled = on;
    },
  };

  // The frame gesture, held for 0.7 s.
  app.everyFrame((_dt, now) => {
    if (!enabled || busy) return;
    const l = hands.left;
    const r = hands.right;
    if (!l.tracked || !r.tracked) {
      holdSince = -1;
      return;
    }
    const cam = world.camera;
    cam.getWorldPosition(head);
    mid.copy(l.indexTip).add(r.indexTip).multiplyScalar(0.5);
    const fwd = new Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    const ok = isFrameGesture({
      leftThumbIndex: l.thumbTip.distanceTo(l.indexTip),
      rightThumbIndex: r.thumbTip.distanceTo(r.indexTip),
      handsApart: l.wrist.distanceTo(r.wrist),
      ahead: mid.clone().sub(head).dot(fwd),
      heightBelowEyes: head.y - mid.y,
    }) && !l.palmUp && !r.palmUp && l.palmNormal.dot(r.palmNormal) < 0.2;
    if (!ok) {
      holdSince = -1;
      return;
    }
    if (holdSince < 0) holdSince = now;
    else if (now - holdSince > 700) {
      holdSince = -1;
      void postcard.take();
    }
  });

  registerTest('postcard', () => postcard.take());
  registerDebug('postcard', { take: postcard.take, hide: postcard.hide });
  return postcard;
}
