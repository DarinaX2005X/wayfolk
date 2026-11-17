/**
 * Entering through the clouds (PROJECT «Фишки» 1). In the person's room, soft clouds rise
 * from the floor and fill it, the walls dissolve from the floor up into the sunset sky,
 * then the clouds part and the island is there. Leaving reverses it and leaves the island
 * small and glowing on the real table as a farewell.
 *
 * Two pieces, both one draw call: a veil (a sphere around the head painted with the
 * sunset, appearing in soft noisy patches) and a bank of cloud puffs (camera-facing
 * instanced quads with a painted cumulus texture).
 */
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from '@iwsdk/core';

const PUFFS = 64;

function cloudTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  // A few soft lobes make one cumulus puff.
  const lobes = [
    [128, 150, 90],
    [80, 160, 62],
    [176, 158, 66],
    [110, 112, 62],
    [156, 116, 56],
  ];
  for (const [x, y, r] of lobes) {
    const grad = g.createRadialGradient(x, y, r * 0.15, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function puffMaterial(map: CanvasTexture): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      map: { value: map },
      opacity: { value: 0 },
      top: { value: new Color('#fff4e6') },
      bottom: { value: new Color('#f3b892') },
    },
    vertexShader: `
      attribute float aFade;
      varying vec2 vUv; varying float vFade;
      void main() {
        vUv = uv; vFade = aFade;
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        centre.xy += position.xy * s;
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform float opacity; uniform vec3 top; uniform vec3 bottom;
      varying vec2 vUv; varying float vFade;
      void main() {
        vec4 t = texture2D(map, vUv);
        vec3 col = mix(bottom, top, smoothstep(0.15, 0.85, vUv.y));
        float a = t.a * opacity * vFade;
        if (a < 0.01) discard;
        gl_FragColor = vec4(col * (0.85 + 0.15 * t.r), a);
      }`,
  });
}

function veilMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      progress: { value: 0 },
      zenith: { value: new Color('#5a7fa8') },
      sunset: { value: new Color('#f6a76b') },
      horizon: { value: new Color('#ffe0b0') },
      below: { value: new Color('#f7c6a3') },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float progress; uniform vec3 zenith; uniform vec3 sunset; uniform vec3 horizon; uniform vec3 below;
      varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i), h(i+vec3(1,0,0)), f.x), mix(h(i+vec3(0,1,0)), h(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i+vec3(0,0,1)), h(i+vec3(1,0,1)), f.x), mix(h(i+vec3(0,1,1)), h(i+vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        float y = vDir.y;
        vec3 sky = y > 0.0 ? mix(horizon, mix(sunset, zenith, smoothstep(0.15, 0.75, y)), smoothstep(0.0, 0.2, y)) : mix(horizon, below, smoothstep(0.0, -0.4, y));
        // The sun low ahead-left: a warm glow.
        float sun = pow(max(0.0, dot(vDir, normalize(vec3(-0.5, 0.12, -0.85)))), 24.0);
        sky += vec3(1.0, 0.82, 0.55) * sun * 0.6;
        float noise = n(vDir * 4.0) * 0.6 + n(vDir * 9.0) * 0.4;
        // From the floor up, in soft patches.
        float order = (y * 0.5 + 0.5) * 0.55 + noise * 0.45;
        float a = smoothstep(order - 0.08, order + 0.08, progress * 1.25 - 0.1);
        if (a < 0.003) discard;
        gl_FragColor = vec4(sky, a);
      }`,
  });
}

export type CloudFx = {
  root: Object3D;
  /** 0: no veil, 1: the sunset all around. */
  veil: number;
  /** 0: no clouds, 1: the clouds fill the room. */
  fill: number;
  /** -1 below the floor, 0 around the person, 1 parted outward and down. */
  rise: number;
  /** Keeps the veil and the clouds centred on the head; call every frame. */
  follow(head: Vector3, floorY: number): void;
};

export function createCloudFx(): CloudFx {
  const root = new Group();
  root.name = 'entry:clouds';
  const veilMat = veilMaterial();
  const veil = new Mesh(new SphereGeometry(6, 40, 24), veilMat);
  veil.name = 'entry:veil';
  veil.renderOrder = 50;
  veil.frustumCulled = false;
  root.add(veil);

  const map = cloudTexture();
  const mat = puffMaterial(map);
  const puffs = new InstancedMesh(new PlaneGeometry(1, 1), mat, PUFFS);
  puffs.name = 'entry:puffs';
  puffs.renderOrder = 60;
  puffs.frustumCulled = false;
  puffs.instanceMatrix.setUsage(DynamicDrawUsage);
  const fade = new Float32Array(PUFFS).fill(1);
  puffs.geometry.setAttribute('aFade', new InstancedBufferAttribute(fade, 1));
  root.add(puffs);
  // Fixed layout around the person: angle, distance, height share, size.
  const layout = Array.from({ length: PUFFS }, (_, i) => {
    const a = i * 2.399963 + Math.sin(i * 3.1) * 0.3;
    const d = 0.9 + ((i * 37) % 100) / 100 * 2.6;
    const hy = ((i * 61) % 100) / 100;
    const s = 0.9 + ((i * 17) % 100) / 100 * 1.4;
    return { a, d, hy, s };
  });
  const m = new Matrix4();
  const pos = new Vector3();
  const scl = new Vector3();
  const centre = new Vector3();
  let floor = 0;
  let t = 0;

  // A soft warm light from below while the clouds are around.
  const glow = new PointLight('#ffb37a', 0, 6, 1.5);
  root.add(glow);

  const fx: CloudFx = {
    root,
    veil: 0,
    fill: 0,
    rise: -1,
    follow(head, floorY) {
      t += 1 / 72;
      floor = floorY;
      centre.copy(head);
      veil.position.copy(head);
      veilMat.uniforms.progress.value = fx.veil;
      veil.visible = fx.veil > 0.001;
      mat.uniforms.opacity.value = Math.min(1, fx.fill);
      puffs.visible = fx.fill > 0.001;
      glow.intensity = fx.fill * 0.8;
      glow.position.set(head.x, floor + 0.2, head.z);
      if (!puffs.visible) return;
      for (let i = 0; i < PUFFS; i += 1) {
        const L = layout[i];
        const spread = 1 + Math.max(0, fx.rise) * 2.2;
        const a = L.a + t * 0.02 * (i % 2 ? 1 : -1);
        const d = L.d * spread;
        // Below the floor at rise -1, from the floor to above the eyes at 0, sinking away at 1.
        const yTop = floor + 0.1 + L.hy * (head.y - floor + 0.5);
        const y = fx.rise <= 0 ? floor - 1.2 + (yTop - floor + 1.2) * (1 + fx.rise) : yTop - fx.rise * (2.5 + L.hy * 2);
        pos.set(centre.x + Math.cos(a) * d, y + Math.sin(t * 0.7 + i) * 0.04, centre.z + Math.sin(a) * d);
        const s = L.s * (0.6 + 0.4 * Math.min(1, fx.fill)) * (1 + Math.max(0, fx.rise) * 1.5);
        scl.set(s, s * 0.7, 1);
        m.makeScale(scl.x, scl.y, 1).setPosition(pos);
        puffs.setMatrixAt(i, m);
      }
      puffs.instanceMatrix.needsUpdate = true;
    },
  };
  return fx;
}

/** A soft round glow under the small island on the table. */
export function makeTableGlow(): Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,214,150,0.9)');
  grad.addColorStop(0.5, 'rgba(255,170,110,0.35)');
  grad.addColorStop(1, 'rgba(255,170,110,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'farewell:glow';
  return mesh;
}
