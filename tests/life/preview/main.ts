// Life preview: builds the stand-in island, runs a shot to its moment with a fixed
// step, then renders once. tests/life/shoot.mjs opens one page per shot.
import { NoToneMapping, PerspectiveCamera, SRGBColorSpace, Vector3, WebGLRenderer } from '@iwsdk/core';
import { createBirdModel, FLOCK_COLORS, PIP_COLORS, restBirdPose } from '../../../src/life/bird';
import { createLife } from '../../../src/life/index';
import { createResidentModel, P, POSE_SIZE } from '../../../src/life/resident';
import type { Life } from '../../../src/life/types';
import type { Vehicle } from '../../../src/mind/types';
import { RESIDENTS } from './fixtures';
import { createHand, createStandIn } from './standin';

declare global {
  interface Window {
    __lifeDone?: boolean;
    __lifeInfo?: unknown;
    __life?: Life;
  }
}

const params = new URLSearchParams(location.search);
const shot = params.get('shot') ?? 'flock';
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
document.body.appendChild(renderer.domElement);
const stand = createStandIn();
const { scene, world } = stand;
const camera = new PerspectiveCamera(params.get('fov') ? Number(params.get('fov')) : 62, innerWidth / innerHeight, 0.01, 600);
camera.position.copy(stand.seatEye);
camera.lookAt(new Vector3(0, 0.6, 0));
scene.add(camera);

let t = 0;
const step = 1 / 60;
function run(life: Life, seconds: number, at?: (t: number) => void): void {
  const end = t + seconds;
  while (t < end) {
    t += step;
    at?.(t);
    life.update(step, t);
  }
}

async function main(): Promise<void> {
  if (shot === 'birds' || shot === 'lineup') {
    staticShots();
  } else {
    const life = createLife({ scene, camera }, world);
    window.__life = life;
    await life.ready;
    await document.fonts.ready;
    await shotWith(life);
    window.__lifeInfo = { ...life.stats(), sceneCalls: 0 };
  }
  renderer.render(scene, camera);
  const info = (window.__lifeInfo ?? {}) as Record<string, unknown>;
  window.__lifeInfo = { ...info, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  window.__lifeDone = true;
}

async function shotWith(life: Life): Promise<void> {
  switch (shot) {
    case 'pip-hand': {
      const { group, palm } = createHand();
      // Right hand, held out low in front, palm up.
      group.position.copy(stand.seatEye).add(new Vector3(0.12, -0.36, -0.36));
      group.rotation.set(0.25, -0.35, 0.1);
      scene.add(group);
      run(life, 0.5);
      void life.pip.landOn(palm);
      run(life, 4.0, (tt) => {
        group.position.y = stand.seatEye.y - 0.36 + Math.sin(tt * 1.3) * 0.015;
      });
      void life.pip.say('Hello. I am Pip. This little island is yours now.');
      run(life, 1.1);
      camera.position.copy(stand.seatEye);
      camera.lookAt(group.position.clone().add(new Vector3(0, 0.1, 0)));
      break;
    }
    case 'talk': {
      const res = RESIDENTS[0];
      const at = new Vector3(-1.2, 0, 6.6);
      life.spawn(res, { x: at.x, z: at.z });
      life.face(res.id);
      run(life, 1.5);
      void life.say(res.id, 'I came on the evening wind. Do you have room for a baker?', { mood: 'curious' });
      run(life, 1.25);
      camera.position.copy(stand.seatEye);
      camera.lookAt(new Vector3(at.x * 0.85, 0.75, at.z));
      break;
    }
    case 'arrive':
    case 'arrive-dock':
    case 'arrive-whale':
    case 'arrive-kite': {
      const kind: Vehicle = shot === 'arrive-whale' ? 'cloud-whale' : shot === 'arrive-kite' ? 'kite' : 'balloon';
      const res = { ...RESIDENTS[shot === 'arrive-whale' ? 11 : shot === 'arrive-kite' ? 1 : 3], vehicle: kind };
      run(life, 0.5);
      void life.arrive(res, kind);
      run(life, shot === 'arrive-dock' ? 10.8 : Number(params.get('t') ?? 5.6));
      camera.position.copy(stand.seatEye);
      camera.lookAt(new Vector3(-12, 0.8, -6.5));
      break;
    }
    case 'build': {
      const steps = stand.buildPlan({ x: 1.5, z: -1.5 }, 0.35);
      run(life, 0.5);
      void life.build(steps);
      run(life, Number(params.get('t') ?? 9.0));
      camera.position.copy(stand.seatEye);
      camera.lookAt(new Vector3(1.6, 1.4, -1.5));
      break;
    }
    case 'flock': {
      const homes = [
        { x: 3.5, z: -2 },
        { x: -3, z: -4 },
        { x: 6, z: 3 },
        { x: -6, z: 2 },
        { x: 1, z: -7 },
        { x: -1.5, z: 3.5 },
      ];
      RESIDENTS.slice(0, 6).forEach((r, i) => life.spawn(r, homes[i]));
      life.startDaily();
      run(life, Number(params.get('t') ?? 24));
      camera.position.copy(stand.seatEye).add(new Vector3(0, 0.3, 0));
      camera.lookAt(new Vector3(0, 1.2, -2));
      break;
    }
  }
}

function staticShots(): void {
  if (shot === 'birds') {
    const all = [createBirdModel(PIP_COLORS, 1, true), ...FLOCK_COLORS.slice(0, 4).map((c) => createBirdModel(c, 1))];
    all.forEach((b, i) => {
      b.mesh.position.set((i - 2) * 0.13, 0.5, 6);
      b.mesh.rotation.y = 0.35 - i * 0.12;
      const p = restBirdPose();
      if (i === 1) {
        p.fly = 1;
        p.phase = 1;
      }
      if (i === 2) {
        p.beak = 1;
        p.headRoll = 0.3;
      }
      if (i === 3) p.preen = 0.8;
      if (i === 4) {
        p.blink = 1;
        p.squash = 0.85;
      }
      b.apply(p);
      scene.add(b.mesh);
    });
    camera.position.set(0, 0.6, 6.55);
    camera.lookAt(new Vector3(0, 0.53, 6));
  } else {
    RESIDENTS.forEach((res, i) => {
      const m = createResidentModel(res);
      const row = i < 6 ? 0 : 1;
      const col = i % 6;
      m.mesh.position.set((col - 2.5) * 0.62 + row * 0.3, 0, 4 - row * 1.0);
      m.mesh.rotation.y = -(col - 2.5) * 0.08;
      const pose = new Float32Array(POSE_SIZE);
      pose[P.SQUASH] = 1;
      if (i === 2) {
        pose[P.ARZ] = -2.4;
        pose[P.HZ] = 0.2;
      }
      if (i === 4) pose[P.JAW] = 1;
      if (i === 7) pose[P.HZ] = -0.3;
      m.apply(pose);
      scene.add(m.mesh);
    });
    camera.position.set(0.15, 1.15, 6.3);
    camera.lookAt(new Vector3(0.15, 0.32, 3.4));
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  window.__lifeInfo = { error: String(error) };
  window.__lifeDone = true;
});
