/**
 * Shared materials. Almost everything static is drawn with ONE Lambert material that reads
 * vertex colours. The colour alpha carries a surface id (geo.ts M): the material adds that
 * surface's stylized texture (triplanar, world space), sways leaves with the island wind in
 * three layers (slow bend, branch sway, leaf flutter), puts a soft rim of light on foliage,
 * and turns id 0 (window glass, lantern flames) warm and bright at night.
 *
 * Grass and flowers are instanced and sway on the GPU: gusts roll across the meadow as
 * waves that bend the blades and lighten them.
 */
import { Color, DoubleSide, MeshLambertMaterial } from '@iwsdk/core';
import { SURF_AMP, SURF_LAYER, SURF_SCALE, surfaceTextures } from './textures';
import { WIND_GLSL, wind } from './wind';

export const U = {
  time: { value: 0 },
  glow: { value: 0 },
  glowColor: { value: new Color('#ffc46e') },
  rim: { value: new Color('#ffe2b0') },
};

let main: MeshLambertMaterial | null = null;
let foliage: MeshLambertMaterial | null = null;

const MAIN_VERTEX_HEAD = /* glsl */ `
${WIND_GLSL}
uniform float uTime;
varying vec3 vWPos;
varying vec3 vWNorm;
varying float vSurf;
`;

const MAIN_VERTEX_BODY = /* glsl */ `
#include <begin_vertex>
{
  #ifdef USE_COLOR_ALPHA
    vSurf = floor(color.a * 15.0 + 0.5);
  #else
    vSurf = 15.0;
  #endif
  vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
  if (abs(vSurf - 7.0) < 0.5) {
    // leaves: slow bend with the gust, branch sway, fast flutter
    float g = windGust(wp0.xz);
    float s = uWindStrength;
    vec2 bend = uWindDir * (0.05 + 0.12 * g) * s;
    float ph = dot(wp0, vec3(0.37, 0.21, 0.29));
    float sway = sin(uWindTime * 1.3 + ph) * (0.025 + 0.04 * g) * s;
    float flutter = sin(uWindTime * 9.0 + ph * 7.0) * 0.012 * (0.4 + g) * s;
    transformed.x += bend.x + sway + flutter;
    transformed.z += bend.y + sway * 0.6 - flutter;
    transformed.y += flutter * 0.5;
  }
  vec4 wpos = modelMatrix * vec4(transformed, 1.0);
  vWPos = wpos.xyz;
}`;

const MAIN_FRAGMENT_HEAD = /* glsl */ `
uniform float uGlow;
uniform vec3 uGlowColor;
uniform vec3 uRim;
uniform sampler2DArray uSurf;
uniform float uSurfLayer[16];
uniform float uSurfScale[16];
uniform float uSurfAmp[16];
varying vec3 vWPos;
varying vec3 vWNorm;
varying float vSurf;
`;

const MAIN_FRAGMENT_SURFACE = /* glsl */ `
#include <color_fragment>
{
  int sid = int(vSurf + 0.5);
  if (sid > 0 && sid < 15) {
    float layer = uSurfLayer[sid];
    vec3 p = vWPos / uSurfScale[sid];
    vec3 bw = abs(normalize(vWNorm));
    bw = pow(bw, vec3(4.0));
    bw /= (bw.x + bw.y + bw.z + 1e-5);
    float d = texture(uSurf, vec3(p.zy, layer)).r * bw.x
            + texture(uSurf, vec3(p.xz, layer)).r * bw.y
            + texture(uSurf, vec3(p.xy, layer)).r * bw.z;
    float fade = 1.0 - smoothstep(30.0, 90.0, length(vWPos - cameraPosition));
    diffuseColor.rgb *= 1.0 + uSurfAmp[sid] * (d - 0.5) * 2.0 * fade;
  }
}`;

const MAIN_FRAGMENT_END = /* glsl */ `
{
  int sid = int(vSurf + 0.5);
  float glowMask = sid == 0 ? 1.0 : 0.0;
  vec3 warm = uGlowColor * (0.85 + 0.3 * max(vColor.r, vColor.g));
  outgoingLight = mix(outgoingLight, warm, glowMask * uGlow);
  outgoingLight += vColor.rgb * glowMask * 0.22;
  vec3 V = normalize(cameraPosition - vWPos);
  float rim = pow(1.0 - clamp(dot(normalize(vWNorm), V), 0.0, 1.0), 3.0);
  float foliage = (sid == 7 || sid == 1) ? 1.0 : 0.25;
  outgoingLight += uRim * rim * foliage * 0.35 * diffuseColor.rgb * 2.0;
}
#include <opaque_fragment>`;

/** The one material for static pieces. */
export function mainMaterial(): MeshLambertMaterial {
  if (main) return main;
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.name = 'world:main';
  const surf = surfaceTextures();
  m.onBeforeCompile = (s) => {
    s.uniforms.uGlow = U.glow;
    s.uniforms.uGlowColor = U.glowColor;
    s.uniforms.uRim = U.rim;
    s.uniforms.uTime = U.time;
    s.uniforms.uSurf = { value: surf };
    s.uniforms.uSurfLayer = { value: SURF_LAYER };
    s.uniforms.uSurfScale = { value: SURF_SCALE };
    s.uniforms.uSurfAmp = { value: SURF_AMP };
    Object.assign(s.uniforms, wind.uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${MAIN_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', MAIN_VERTEX_BODY)
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${MAIN_FRAGMENT_HEAD}`)
      .replace('#include <color_fragment>', MAIN_FRAGMENT_SURFACE)
      .replace('#include <opaque_fragment>', MAIN_FRAGMENT_END);
  };
  m.customProgramCacheKey = () => 'world-main-v2';
  main = m;
  return m;
}

/**
 * Grass and flowers: instanced, vertex colours from base to tip; the colour alpha holds how
 * much a vertex sways (0 at the root, 1 at the tip).
 */
export function foliageMaterial(): MeshLambertMaterial {
  if (foliage) return foliage;
  const m = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  m.name = 'world:foliage';
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.time;
    s.uniforms.uRim = U.rim;
    Object.assign(s.uniforms, wind.uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform float uTime;\nvarying float vGust;\nvarying float vTip;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float sway = color.a;
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float g = windGust(wp.xz);
          float s = uWindStrength;
          float ph = wp.x * 0.9 + wp.z * 0.7;
          float jiggle = sin(uTime * 3.7 + ph) * 0.25 + sin(uTime * 6.1 + ph * 1.9) * 0.1;
          vec2 push = uWindDir * (0.05 + 0.32 * g + jiggle * (0.05 + 0.08 * g)) * s;
          // the blade bends along the wind in world space, whatever the instance rotation
          #ifdef USE_INSTANCING
            mat3 inv = transpose(mat3(instanceMatrix));
            vec3 local = inv * vec3(push.x, 0.0, push.y);
            float sc = length(instanceMatrix[0].xyz);
            local /= max(sc * sc, 1e-4);
          #else
            vec3 local = vec3(push.x, 0.0, push.y);
          #endif
          float k = sway * sway;
          transformed.xz += local.xz * k * 0.6;
          transformed.y -= length(push) * k * 0.08;
          vGust = g * s;
          vTip = sway;
        }`,
      )
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGust;\nvarying float vTip;\nuniform vec3 uRim;')
      .replace(
        '#include <opaque_fragment>',
        `diffuseColor.a = 1.0;
        outgoingLight *= 1.0 + vGust * vTip * 0.28;
        outgoingLight += uRim * vTip * 0.06;
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'world-foliage-v2';
  foliage = m;
  return m;
}
