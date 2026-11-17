/**
 * Moving about the island in a headset, hands only, seated or standing.
 *
 *   walk     real steps move the person (the island's ground is the real floor);
 *   hop      point at the grass anywhere and pinch briefly: a glowing ring shows where,
 *            the view closes softly, the person stands there;
 *   pull     pinch the air and draw the hand toward you: the island comes along with the
 *            hand, as if pulling yourself on a rope; the edges of the view dim while it moves.
 *
 * Only when the island is free (no scene, no talk, no choice on offer) and the pinch was
 * not taken by something else (a cloud, a neighbour, a fruit, a ring).
 */
import { AdditiveBlending, CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { App } from '../boot/world';
import type { WorldPort } from '../ports';
import type { Walkable } from '../walkable';
import type { Glide } from './glide';
import type { Hands, Side } from './hands';

function ringTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 30, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,240,200,0.08)');
  r.addColorStop(0.75, 'rgba(255,240,205,0.95)');
  r.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

type Grip = { side: Side; t0: number; startLocal: Vector3; rigStart: Vector3; pulling: boolean };

export function createMove(app: App, hands: Hands, world: WorldPort, glide: Glide, walkable: Walkable, busy: (side: Side) => boolean): { readonly pulling: boolean } {
  const player = app.world.player;
  const ring = new Mesh(new PlaneGeometry(0.7, 0.7), new MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: false, side: DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 5;
  ring.visible = false;
  app.roots.fx.add(ring);
  let grip: Grip | null = null;
  const aim = new Vector3();
  const local = new Vector3();
  const delta = new Vector3();
  const eye = new Vector3();
  const look = new Vector3();
  const next = new Vector3();
  let vig = 0;
  let owned = false;
  const groundY = (x: number, z: number): number => world.groundY?.(x, z) ?? world.groundAt?.(x, z) ?? player.position.y;
  const pinchPoint = (side: Side, out: Vector3): Vector3 => {
    const h = hands.get(side);
    return out.copy(h.indexTip).add(h.thumbTip).multiplyScalar(0.5);
  };

  /** Where the hand's ray meets the grass (a few steps of plane and height), or null. */
  const groundPoint = (side: Side, out: Vector3): Vector3 | null => {
    const h = hands.get(side);
    if (h.rayDir.y > -0.03) return null;
    let y = groundY(h.rayOrigin.x, h.rayOrigin.z);
    for (let i = 0; i < 4; i += 1) {
      const t = (y - h.rayOrigin.y) / h.rayDir.y;
      if (t <= 0 || t > 30) return null;
      out.copy(h.rayOrigin).addScaledVector(h.rayDir, t);
      y = groundY(out.x, out.z);
    }
    out.y = y;
    return out;
  };

  const free = (): boolean => app.store.mode.peek() !== 'desk' && app.store.phase.peek() === 'free' && !app.store.show.peek();

  hands.onPinch((side, down) => {
    if (down) {
      if (grip || !free() || busy(side)) return;
      pinchPoint(side, aim);
      player.updateMatrixWorld(true);
      grip = { side, t0: app.clock.now(), startLocal: player.worldToLocal(aim.clone()), rigStart: player.position.clone(), pulling: false };
      return;
    }
    if (!grip || grip.side !== side) return;
    const g = grip;
    grip = null;
    ring.visible = false;
    if (g.pulling || busy(side) || !free()) return;
    if (app.clock.now() - g.t0 > 700) return;
    // A short pinch while pointing at the grass: hop there (rings have their own glide).
    const p = groundPoint(side, aim);
    if (!p || glide.near(p) >= 0) return;
    app.world.camera.getWorldPosition(eye);
    const d = Math.hypot(p.x - eye.x, p.z - eye.z);
    if (d < 0.8 || !walkable.ok(p.x, p.z)) return;
    app.world.camera.getWorldDirection(look);
    void glide.toPoint(p, Math.atan2(-look.x, -look.z));
  });

  app.everyFrame((dtIn) => {
    const dt = Math.min(0.05, dtIn > 1 ? dtIn / 1000 : dtIn);
    let moving = false;
    if (grip) {
      const h = hands.get(grip.side);
      if (busy(grip.side)) {
        // Something else took this pinch after all (a neighbour, a cloud): let it go.
        grip = null;
        ring.visible = false;
      } else if (!h.tracked || !h.pinching || !free()) {
        if (!h.pinching) {
          // The release is handled by the pinch callback.
        } else {
          grip = null;
          ring.visible = false;
        }
      } else {
        pinchPoint(grip.side, aim);
        player.updateMatrixWorld(true);
        // The hand in the rig's own frame, so moving the rig does not feed back into it.
        local.copy(aim);
        player.worldToLocal(local);
        delta.subVectors(local, grip.startLocal).setY(0);
        if (!grip.pulling && delta.length() > 0.05) grip.pulling = true;
        if (grip.pulling) {
          // The island comes with the hand: the rig moves the other way, 1:1, on the grass only.
          delta.applyQuaternion(player.quaternion);
          next.copy(grip.rigStart).sub(delta.multiplyScalar(1.6));
          app.world.camera.getWorldPosition(eye);
          const ex = eye.x + (next.x - player.position.x);
          const ez = eye.z + (next.z - player.position.z);
          if (walkable.ok(ex, ez)) {
            const step = Math.hypot(next.x - player.position.x, next.z - player.position.z);
            moving = step > 0.002;
            player.position.x = next.x;
            player.position.z = next.z;
            player.position.y += (groundY(ex, ez) - player.position.y) * Math.min(1, dt * 8);
          }
          ring.visible = false;
        } else if (app.clock.now() - grip.t0 > 120) {
          const p = groundPoint(grip.side, aim);
          ring.visible = Boolean(p && walkable.ok(p.x, p.z) && glide.near(p) < 0);
          if (p) ring.position.set(p.x, p.y + 0.04, p.z);
        }
      }
    }
    // Comfort: the edges of the view dim while the island slides by.
    const want = moving ? 0.45 : 0;
    vig += (want - vig) * Math.min(1, dt * (moving ? 10 : 4));
    if (moving || vig > 0.002) {
      glide.vignette.amount = vig;
      owned = true;
    } else if (owned) {
      glide.vignette.amount = 0;
      owned = false;
    }
  });

  return {
    get pulling() {
      return Boolean(grip?.pulling);
    },
  };
}
