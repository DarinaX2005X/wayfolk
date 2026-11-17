/**
 * An honest note when a traveler (or their line) comes from the prepared set instead of a
 * live model: a small kraft-paper luggage tag on a string, hanging beside them while you
 * talk. It is part of the world, in a page and in a headset alike.
 */
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Object3D } from '@iwsdk/core';
import type { App } from './boot/world';

function tagTexture(text: string): CanvasTexture {
  const W = 512;
  const H = 200;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // The string loop up to the corner.
  g.strokeStyle = '#8a6a4a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(70, 100);
  g.bezierCurveTo(40, 40, 10, 30, 6, 6);
  g.stroke();
  // The tag: a card with clipped corners at the string end.
  g.save();
  g.shadowColor = 'rgba(60,35,20,0.35)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  g.beginPath();
  g.moveTo(95, 40);
  g.lineTo(W - 20, 40);
  g.quadraticCurveTo(W - 8, 40, W - 8, 52);
  g.lineTo(W - 8, H - 32);
  g.quadraticCurveTo(W - 8, H - 20, W - 20, H - 20);
  g.lineTo(95, H - 20);
  g.lineTo(52, H - 62);
  g.lineTo(52, 82);
  g.closePath();
  g.fillStyle = '#d9b98a';
  g.fill();
  g.restore();
  // The eyelet.
  g.fillStyle = '#f3e3c3';
  g.beginPath();
  g.arc(78, 100, 13, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#a07a50';
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = '#4a3020';
  g.font = "700 46px 'Atkinson Hyperlegible Next', system-ui, sans-serif";
  g.textBaseline = 'middle';
  g.fillText(text, 118, (40 + H - 20) / 2 + 2, W - 150);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function createPreparedTag(app: App, objectOf: (id: string) => Object3D | null | undefined): void {
  const mat = new MeshBasicMaterial({ map: tagTexture('prepared traveler'), transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
  const tag = new Mesh(new PlaneGeometry(0.36, (0.36 * 200) / 512), mat);
  tag.name = 'tag:prepared';
  tag.renderOrder = 55;
  tag.visible = false;
  app.roots.fx.add(tag);
  const at = new Vector3();
  const eye = new Vector3();
  app.everyFrame((_dt, now) => {
    const id = app.store.talkingTo.peek();
    const o = id ? objectOf(id) : null;
    tag.visible = Boolean(o && app.store.prepared.peek());
    if (!tag.visible || !o) return;
    o.updateWorldMatrix(true, false);
    o.getWorldPosition(at);
    app.world.camera.getWorldPosition(eye);
    // Low beside them, to the right as the person sees it, turned to the person, swaying a little.
    const dx = eye.x - at.x;
    const dz = eye.z - at.z;
    const len = Math.hypot(dx, dz) || 1;
    tag.position.set(at.x + (dz / len) * 0.38, at.y + 0.16, at.z - (dx / len) * 0.38);
    tag.rotation.set(0, Math.atan2(dx, dz), Math.sin(now / 900) * 0.06);
  });
}
