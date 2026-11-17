/**
 * A thin stand-in for `createWorld` (src/world/), used only until the world module lands.
 * A small low-poly island over a sea of clouds at sunset, a pier, a bench seat, simple
 * houses built from boxes. Same shape as the contract (src/app/ports.ts WorldPort).
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  HemisphereLight,
  DirectionalLight,
} from '@iwsdk/core';
import type { HouseSpec, P2 } from '../../mind/types';
import type { AppHandle, BuildStep, WorldPort } from '../ports';

const R = 13;

function lambert(color: string, emissive?: string): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ color, flatShading: true });
  if (emissive) m.emissive = new Color(emissive);
  return m;
}

function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color('#3d5f86') },
      mid: { value: new Color('#f2a66b') },
      low: { value: new Color('#ffd9a8') },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(low, mid, smoothstep(-0.2, 0.08, h)); gl_FragColor = vec4(c, 1.0); }',
  });
}

function cloudSeaMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { t: { value: 0 }, a: { value: new Color('#ffe2c2') }, b: { value: new Color('#e9a27e') } },
    vertexShader: 'varying vec2 vU; varying vec3 vW; void main(){ vU = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform float t; uniform vec3 a; uniform vec3 b; varying vec2 vU; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, m = 0.5; for (int k = 0; k < 4; k++){ s += m*n(p); p *= 2.03; m *= 0.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.035 + vec2(t * 0.004, t * 0.002);
        float c = fbm(p);
        float d = length(vW.xz) / 400.0;
        vec3 col = mix(b, a, smoothstep(0.35, 0.75, c));
        gl_FragColor = vec4(col, 1.0 - smoothstep(0.75, 1.0, d));
      }`,
  });
}

export function createStandinWorld(app: AppHandle): WorldPort {
  const root = new Group();
  root.name = 'standin:world';

  // Light: warm sun low in the west, soft sky fill.
  const hemi = new HemisphereLight('#ffe7c4', '#6d5a78', 1.6);
  const sun = new DirectionalLight('#ffc98a', 2.2);
  sun.position.set(-30, 18, -20);
  root.add(hemi, sun);

  const sky = new Mesh(new SphereGeometry(600, 32, 16), skyMaterial());
  sky.name = 'standin:sky';
  sky.renderOrder = -10;
  root.add(sky);

  const seaMat = cloudSeaMaterial();
  const sea = new Mesh(new PlaneGeometry(1200, 1200, 1, 1), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -9;
  sea.name = 'standin:cloud-sea';
  root.add(sea);
  app.everyFrame((_dt, now) => {
    seaMat.uniforms.t.value = now / 1000;
  });

  // Puffs of cloud around the island.
  const puffMat = lambert('#fff1e0');
  puffMat.emissive = new Color('#6b4a3a');
  const puff = new DodecahedronGeometry(1, 1);
  for (let i = 0; i < 26; i += 1) {
    const a = (i / 26) * Math.PI * 2 + Math.sin(i * 7.1) * 0.2;
    const d = 22 + (i % 5) * 9;
    const m = new Mesh(puff, puffMat);
    const s = 3 + ((i * 37) % 11) * 0.5;
    m.scale.set(s * 1.6, s * 0.7, s);
    m.position.set(Math.cos(a) * d, -8 + (i % 3), Math.sin(a) * d);
    root.add(m);
  }

  // The island: a grassy top, a cliff, a rocky root falling into the clouds.
  const top = new Mesh(new CylinderGeometry(R, R - 0.6, 1.2, 28, 1), lambert('#7fb24a'));
  top.position.y = -0.6;
  const cliff = new Mesh(new CylinderGeometry(R - 0.6, R * 0.45, 5, 28, 2), lambert('#9a6b47'));
  cliff.position.y = -3.7;
  const rootRock = new Mesh(new ConeGeometry(R * 0.45, 7, 18), lambert('#7d5640'));
  rootRock.rotation.x = Math.PI;
  rootRock.position.y = -9.7;
  const sand = new Mesh(new CylinderGeometry(3.4, 3.2, 1.1, 14), lambert('#e9cf98'));
  sand.position.set(-1.5, -0.62, -R + 0.8);
  root.add(top, cliff, rootRock, sand);

  // Trees, rocks, flowers.
  const trunk = new CylinderGeometry(0.12, 0.18, 1.4, 6);
  const crown = new ConeGeometry(1, 2.2, 7);
  const trunkMat = lambert('#7a5236');
  const crownMats = [lambert('#4f8f3c'), lambert('#6aa443'), lambert('#3f7d43')];
  const trees: [number, number, number][] = [
    [-8, 3, 1.2], [-9.5, -2, 1.4], [-6.5, 7, 1], [8.5, 2.5, 1.3], [9.5, -3, 1.1], [7, 7.5, 1], [-3, -9, 0.9], [5, -9.5, 1.2], [-10.5, 5.5, 0.8], [10.8, 5.5, 0.9], [2, 9.8, 0.8], [-4.5, 10, 1],
  ];
  trees.forEach(([x, z, s], i) => {
    const t = new Group();
    const a = new Mesh(trunk, trunkMat);
    a.position.y = 0.7;
    const c = new Mesh(crown, crownMats[i % 3]);
    c.position.y = 2.2;
    t.add(a, c);
    t.position.set(x, 0, z);
    t.scale.setScalar(s * 1.3);
    root.add(t);
  });
  const rock = new DodecahedronGeometry(0.5, 0);
  const rockMat = lambert('#a59a8f');
  for (let i = 0; i < 14; i += 1) {
    const a = i * 2.4;
    const d = 6 + (i % 4) * 1.6;
    const m = new Mesh(rock, rockMat);
    m.position.set(Math.cos(a) * d, 0.1, Math.sin(a) * d);
    m.scale.set(1 + (i % 3) * 0.4, 0.6, 1);
    root.add(m);
  }
  const flower = new SphereGeometry(0.09, 6, 4);
  const petals = [lambert('#ffd166'), lambert('#f78c6b'), lambert('#ffffff'), lambert('#e07a9e')];
  for (let i = 0; i < 70; i += 1) {
    const a = i * 2.399;
    const d = 2.5 + ((i * 53) % 90) / 10;
    const m = new Mesh(flower, petals[i % 4]);
    m.position.set(Math.cos(a) * d, 0.08, Math.sin(a) * d);
    root.add(m);
  }

  // The pier ahead of the seat, reaching out over the clouds.
  const pier = new Object3D();
  pier.name = 'standin:pier';
  pier.position.set(2.5, 0, -R - 3.5);
  pier.rotation.y = Math.PI;
  const plankMat = lambert('#a8754a');
  const deck = new Mesh(new BoxGeometry(1.6, 0.12, 6), plankMat);
  deck.position.set(2.5, -0.05, -R - 1.5);
  root.add(deck);
  for (const dx of [-0.7, 0.7]) {
    for (const dz of [-4, -1.5, 1]) {
      const post = new Mesh(new CylinderGeometry(0.08, 0.08, 1.6, 6), plankMat);
      post.position.set(2.5 + dx, -0.5, -R - 1.5 + dz);
      root.add(post);
    }
  }
  root.add(pier);

  // The seat: a bench near the south edge, looking north over the island to the pier.
  const seat = new Object3D();
  seat.name = 'standin:seat';
  seat.position.set(0, 0, 8.5);
  root.add(seat);
  const bench = new Mesh(new BoxGeometry(1.4, 0.08, 0.45), plankMat);
  bench.position.set(0, 0.42, 8.6);
  root.add(bench);

  const houses = new Map<string, Group>();
  const props: Object3D[] = [];

  const validSpot: WorldPort['validSpot'] = (p) => {
    const x = p.x;
    const z = p.z;
    const d = Math.hypot(x, z);
    let ok = d < R - 2.2 && Math.hypot(x - seat.position.x, z - seat.position.z) > 3.5;
    for (const h of houses.values()) if (Math.hypot(h.position.x - x, h.position.z - z) < 3.6) ok = false;
    for (const [tx, tz] of trees) if (Math.hypot(tx - x, tz - z) < 1.8) ok = false;
    const rotY = Math.atan2(seat.position.x - x, seat.position.z - z);
    return { ok, snapped: { x, y: 0, z }, rotY };
  };

  const buildPlan = (spec: HouseSpec): BuildStep[] => {
    const group = new Group();
    group.name = `house:${spec.id}`;
    group.position.set(spec.pos.x, 0, spec.pos.z);
    group.rotation.y = spec.rotY;
    root.add(group);
    houses.set(spec.id, group);
    const parts: [Object3D, Vector3][] = [];
    const add = (mesh: Object3D, x: number, y: number, z: number): void => {
      parts.push([mesh, new Vector3(x, y, z)]);
    };
    add(new Mesh(new BoxGeometry(3, 0.3, 2.6), lambert('#b9a58f')), 0, 0.15, 0);
    add(new Mesh(new BoxGeometry(2.6, 1.9, 2.2), lambert(spec.colors.wall)), 0, 1.25, 0);
    const roof = new Mesh(new ConeGeometry(2.25, 1.5, 4), lambert(spec.colors.roof));
    roof.rotation.y = Math.PI / 4;
    add(roof, 0, 2.95, 0);
    add(new Mesh(new BoxGeometry(0.6, 1.1, 0.08), lambert(spec.colors.trim)), 0, 0.85, 1.12);
    const win = new Mesh(new BoxGeometry(0.55, 0.5, 0.06), lambert('#4a3b30'));
    win.name = `window:${spec.id}`;
    add(win, -0.8, 1.45, 1.12);
    const win2 = new Mesh(new BoxGeometry(0.55, 0.5, 0.06), lambert('#4a3b30'));
    win2.name = `window:${spec.id}`;
    add(win2, 0.8, 1.45, 1.12);
    add(new Mesh(new BoxGeometry(0.35, 0.9, 0.35), lambert(spec.colors.trim)), 0.7, 3.2, -0.4);
    return parts.map(([object3d, pos]) => {
      group.add(object3d);
      object3d.position.copy(pos);
      const target = { pos: pos.clone(), quat: object3d.quaternion.clone() as Quaternion, scale: new Vector3(1, 1, 1) };
      return { object3d, target };
    });
  };

  const lightHouse = (id: string, on = true): void => {
    houses.get(id)?.traverse((o) => {
      if (o.name === `window:${id}`) {
        const m = (o as Mesh).material as MeshLambertMaterial;
        m.color.set(on ? '#ffd27a' : '#4a3b30');
        m.emissive.set(on ? '#ffb347' : '#000000');
      }
    });
  };

  const world: WorldPort = {
    root,
    ready: Promise.resolve(),
    setTime(date) {
      const h = date.getHours() + date.getMinutes() / 60;
      const night = h < 6 || h > 21;
      const mat = sky.material as ShaderMaterial;
      mat.uniforms.top.value.set(night ? '#14213d' : '#3d5f86');
      mat.uniforms.mid.value.set(night ? '#2c3e66' : '#f2a66b');
      hemi.intensity = night ? 0.6 : 1.6;
    },
    validSpot,
    buildPlan,
    addHouse(spec) {
      for (const s of buildPlan(spec)) {
        s.object3d.position.copy(s.target.pos);
      }
      lightHouse(spec.id, true);
    },
    addPath() {
      return null;
    },
    addProp(kind, pos: P2 | { x: number; z: number }) {
      const m = new Mesh(new SphereGeometry(0.25, 8, 6), lambert('#e07a5f'));
      m.name = `prop:${kind}`;
      m.position.set(pos.x, 0.25, pos.z);
      root.add(m);
      props.push(m);
      return m;
    },
    setHorizon() {
      return undefined;
    },
    pier,
    seat,
    spots() {
      return [
        { x: 0, z: 8.5, rotY: 0 },
        { x: -6, z: 2, rotY: -Math.PI / 2 },
        { x: 6, z: 2, rotY: Math.PI / 2 },
        { x: 2.5, z: -R + 1, rotY: 0 },
      ];
    },
    groundAt(x, z) {
      return Math.hypot(x, z) < R ? 0 : -100;
    },
    lightHouse,
  };
  return world;
}
