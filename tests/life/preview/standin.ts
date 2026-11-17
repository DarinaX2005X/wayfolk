// A stand-in island for the life preview until src/world/ lands: sky, sea of clouds,
// a grassy island with cliffs, a pier, the seat, a few trees, and a stand-in house plan.
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  BackSide,
} from '@iwsdk/core';
import type { BuildStep, LifeWorld } from '../../../src/life/types';

const mat = (color: string, rough = 0.9): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: false });

export interface StandIn {
  world: LifeWorld;
  scene: Scene;
  seatEye: Vector3;
  buildPlan(at: { x: number; z: number }, rotY: number): BuildStep[];
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createStandIn(): StandIn {
  const scene = new Scene();
  scene.background = new Color('#f2c7a0');
  scene.fog = new Fog('#f4cfae', 28, 120);

  // Sky dome with a sunset gradient.
  const skyGeo = new SphereGeometry(300, 32, 16);
  const cols: number[] = [];
  const pos = skyGeo.getAttribute('position');
  const top = new Color('#6f8fbf');
  const mid = new Color('#f7b98c');
  const low = new Color('#ffe4c8');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 300;
    if (y > 0.12) c.copy(mid).lerp(top, Math.min(1, (y - 0.12) / 0.6));
    else c.copy(low).lerp(mid, Math.max(0, (y + 0.1) / 0.22));
    cols.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new BufferAttribute(new Float32Array(cols), 3));
  const sky = new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  scene.add(sky);
  const sun = new Mesh(new SphereGeometry(9, 20, 12), new MeshBasicMaterial({ color: '#fff1d6', fog: false }));
  sun.position.set(-90, 22, -230);
  scene.add(sun);

  scene.add(new HemisphereLight('#ffe2c4', '#7a6352', 1.25));
  const key = new DirectionalLight('#ffc996', 2.1);
  key.position.set(-6, 7, 8);
  scene.add(key);
  const back = new DirectionalLight('#ffb27a', 0.9);
  back.position.set(-4, 3, -12);
  scene.add(back);

  const root = new Group();
  root.name = 'standin-root';
  scene.add(root);
  const rand = seeded(7);

  // Sea of clouds: big soft blobs below the island.
  const cloudMat = new MeshStandardMaterial({ color: '#fff0e2', roughness: 1, emissive: '#f7c8a5', emissiveIntensity: 0.25 });
  const cloudGeo = new IcosahedronGeometry(1, 3);
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2;
    const r = 10 + rand() * 60;
    const m = new Mesh(cloudGeo, cloudMat);
    const s = 3 + rand() * 6;
    m.scale.set(s * 1.6, s * 0.55, s * 1.2);
    m.position.set(Math.cos(a) * r, -3.6 - rand() * 2.5, Math.sin(a) * r);
    root.add(m);
  }

  // Island top and cliffs.
  const grass = new Mesh(new CylinderGeometry(13, 12.6, 0.5, 48), mat('#79b552'));
  grass.position.y = -0.25;
  root.add(grass);
  const cliff = new Mesh(new ConeGeometry(12.6, 7, 40, 4), mat('#a77b58'));
  cliff.rotation.x = Math.PI;
  cliff.position.y = -4;
  root.add(cliff);
  // A dirt path from the seat to the pier.
  const path = new Mesh(new BoxGeometry(1.1, 0.04, 9), mat('#cfa874'));
  path.position.set(-3.6, 0.01, 2.6);
  path.rotation.y = -0.7;
  root.add(path);

  // Trees and bushes for depth.
  const trunkMat = mat('#8a5a3a');
  const leafMats = [mat('#5f9e46'), mat('#4f8c3e'), mat('#76b553')];
  const tree = (x: number, z: number, s: number): void => {
    const g = new Group();
    const trunk = new Mesh(new CylinderGeometry(0.12 * s, 0.18 * s, 1.2 * s, 8), trunkMat);
    trunk.position.y = 0.6 * s;
    g.add(trunk);
    for (let k = 0; k < 3; k++) {
      const leaf = new Mesh(new IcosahedronGeometry(0.75 * s * (1 - k * 0.18), 1), leafMats[k % 3]);
      leaf.position.set((rand() - 0.5) * 0.4 * s, (1.5 + k * 0.55) * s, (rand() - 0.5) * 0.4 * s);
      g.add(leaf);
    }
    g.position.set(x, 0, z);
    root.add(g);
  };
  tree(5.5, -4, 1.4);
  tree(7.5, 1, 1.1);
  tree(-1.5, -8.5, 1.5);
  tree(9, -6, 1.2);
  tree(-9, 4, 1.0);
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = 3 + rand() * 9;
    const b = new Mesh(new IcosahedronGeometry(0.3 + rand() * 0.25, 1), leafMats[i % 3]);
    b.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r);
    b.scale.y = 0.7;
    root.add(b);
  }
  // Flowers
  const flowerCols = ['#ffd166', '#ff8fa3', '#ffffff', '#ff9f5a'];
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2;
    const r = 2 + rand() * 10;
    const f = new Mesh(new SphereGeometry(0.06, 6, 4), mat(flowerCols[i % 4], 0.7));
    f.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    root.add(f);
  }

  // The pier at the front left, reaching into the clouds.
  const wood = mat('#b98352');
  const pier = new Group();
  const deck = new Mesh(new BoxGeometry(1.6, 0.12, 7), wood);
  deck.position.set(0, 0.06, -3.5);
  pier.add(deck);
  for (let k = 0; k < 4; k++) {
    for (const sx of [-0.7, 0.7]) {
      const post = new Mesh(new CylinderGeometry(0.08, 0.08, 1.6, 8), wood);
      post.position.set(sx, -0.5, -1 - k * 2);
      pier.add(post);
    }
  }
  pier.position.set(-9.5, 0, -1.5);
  pier.rotation.y = 0.85;
  root.add(pier);
  const pierTip = new Object3D();
  pierTip.position.set(0, 0.12, -6.6);
  pier.add(pierTip);

  // The seat: a bench at the near edge; the person looks toward -z.
  const bench = new Group();
  const plank = new Mesh(new BoxGeometry(1.6, 0.08, 0.5), wood);
  plank.position.y = 0.45;
  bench.add(plank);
  bench.position.set(0, 0, 9.6);
  root.add(bench);
  const seat = new Object3D();
  seat.position.set(0, 0.45, 9.6);
  root.add(seat);

  const world: LifeWorld = {
    root,
    pier: pierTip,
    seat,
    radius: 12.5,
    heightAt: (x: number, z: number) => (Math.hypot(x, z) < 12.8 ? 0 : -3),
    perches: () => [new Vector3(5.5, 2.9, -4), new Vector3(7.5, 2.3, 1), new Vector3(-1.5, 3.2, -8.5), new Vector3(0.6, 0.53, 9.6), new Vector3(-0.6, 0.53, 9.6)],
    benches: () => [new Vector3(2.5, 0, 6.5), new Vector3(-4.5, 0, -3)],
    spots: () => [new Vector3(0, 0, 3), new Vector3(-6, 0, -1)],
  };

  // Stand-in house plan: foundation, walls, roof, chimney, door, windows, sign.
  const buildPlan = (at: { x: number; z: number }, rotY: number): BuildStep[] => {
    const house = new Group();
    house.position.set(at.x, 0, at.z);
    house.rotation.y = rotY;
    root.add(house);
    const steps: BuildStep[] = [];
    const piece = (name: string, geo: BoxGeometry | ConeGeometry | CylinderGeometry, color: string, p: [number, number, number], ry = 0): void => {
      const m = new Mesh(geo, mat(color));
      m.name = name;
      m.visible = false;
      house.add(m);
      steps.push({ object3d: m, target: { pos: new Vector3(...p), quat: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry), scale: new Vector3(1, 1, 1) } });
    };
    piece('foundation', new BoxGeometry(3.2, 0.3, 2.8), '#9c8a78', [0, 0.15, 0]);
    piece('wall-back', new BoxGeometry(3.0, 1.7, 0.2), '#f2dcc0', [0, 1.15, -1.25]);
    piece('wall-left', new BoxGeometry(0.2, 1.7, 2.5), '#f2dcc0', [-1.4, 1.15, 0]);
    piece('wall-right', new BoxGeometry(0.2, 1.7, 2.5), '#f2dcc0', [1.4, 1.15, 0]);
    piece('wall-front', new BoxGeometry(3.0, 1.7, 0.2), '#f2dcc0', [0, 1.15, 1.25]);
    piece('door', new BoxGeometry(0.7, 1.1, 0.08), '#7b4b2e', [0, 0.85, 1.38]);
    piece('window-left', new BoxGeometry(0.55, 0.5, 0.08), '#ffd88a', [-0.85, 1.35, 1.38]);
    piece('window-right', new BoxGeometry(0.55, 0.5, 0.08), '#ffd88a', [0.85, 1.35, 1.38]);
    const roof = new ConeGeometry(2.6, 1.5, 4, 1);
    roof.rotateY(Math.PI / 4);
    piece('roof', roof, '#c8553d', [0, 2.75, 0]);
    piece('chimney', new BoxGeometry(0.35, 0.8, 0.35), '#9c6b4e', [0.8, 3.0, -0.4]);
    piece('sign', new BoxGeometry(0.8, 0.3, 0.06), '#e9c46a', [0.9, 0.9, 1.6]);
    return steps;
  };

  return { world, scene, seatEye: new Vector3(0, 1.22, 9.7), buildPlan };
}

/** A stylised hand, palm up, so Pip has somewhere to land in the preview. */
export function createHand(): { group: Group; palm: Object3D } {
  const skin = mat('#e8b896', 0.7);
  const group = new Group();
  const palmMesh = new Mesh(new SphereGeometry(0.05, 18, 12), skin);
  palmMesh.scale.set(1.0, 0.32, 1.15);
  group.add(palmMesh);
  const fingers: [number, number, number, number][] = [
    [-0.03, 0.006, -0.075, 0.07],
    [-0.01, 0.008, -0.085, 0.078],
    [0.012, 0.008, -0.082, 0.074],
    [0.032, 0.006, -0.072, 0.06],
  ];
  for (const [x, y, z, l] of fingers) {
    const f = new Mesh(new CylinderGeometry(0.0095, 0.011, l, 10), skin);
    f.rotation.x = Math.PI / 2 - 0.25;
    f.position.set(x, y + 0.01, z + 0.02);
    group.add(f);
    const tip = new Mesh(new SphereGeometry(0.0095, 10, 8), skin);
    tip.position.set(x, y + 0.01 + Math.sin(0.25) * l * 0.5, z + 0.02 - l / 2);
    group.add(tip);
  }
  const thumb = new Mesh(new CylinderGeometry(0.011, 0.013, 0.06, 10), skin);
  thumb.rotation.set(Math.PI / 2, 0, -0.9);
  thumb.position.set(0.058, 0.004, -0.012);
  group.add(thumb);
  const wrist = new Mesh(new CylinderGeometry(0.03, 0.034, 0.16, 14), skin);
  wrist.rotation.x = Math.PI / 2;
  wrist.scale.set(1.35, 1, 0.7);
  wrist.position.set(0, -0.004, 0.11);
  group.add(wrist);
  const sleeve = new Mesh(new CylinderGeometry(0.048, 0.052, 0.18, 16), mat('#5a7ea8', 0.95));
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.set(0, -0.004, 0.26);
  group.add(sleeve);
  // The palm object follows the WebXR joint convention: palm faces local -Y.
  const palm = new Object3D();
  palm.rotation.x = Math.PI;
  palm.position.set(0, 0.014, -0.01);
  group.add(palm);
  return { group, palm };
}
