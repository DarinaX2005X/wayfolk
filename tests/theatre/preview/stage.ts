/**
 * The stage alone, in a plain sky: plays a prepared chapter to the middle of one beat
 * (`stage-<beat>`, or `stage-<beat>-<traveler id>`) and renders it once from the seat.
 */
import { CanvasTexture, Color, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from '@iwsdk/core';
import { directChapter, preparedChapter } from '../../../src/mind/chapters';
import { PREPARED } from '../../../src/mind/prepared';
import { createStage, STAGE } from '../../../src/theatre/stage';

function skyTexture(night: boolean): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  if (night) {
    grad.addColorStop(0, '#0f1a33');
    grad.addColorStop(0.6, '#2b3f66');
    grad.addColorStop(1, '#6a6f8f');
  } else {
    grad.addColorStop(0, '#6f8fc0');
    grad.addColorStop(0.55, '#e9a98a');
    grad.addColorStop(1, '#f6cf9a');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export async function stageShot(shot: string): Promise<void> {
  await document.fonts.load('400 32px "Atkinson Hyperlegible Next"').catch(() => undefined);
  const [, beatText, ...rest] = shot.split('-');
  const id = rest.join('-') || 'p-tea-maker-hedgehog';
  const r = PREPARED.find((p) => p.id === id) ?? PREPARED[0];
  const chapter = preparedChapter(r, 1) ?? directChapter(r, 1);
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(1440, 900);
  renderer.outputColorSpace = SRGBColorSpace;
  document.body.append(renderer.domElement);
  const scene = new Scene();
  scene.background = skyTexture(chapter.mood === 'night');
  // As the page shows it (src/app/evening.ts placeStage): 60 degree view, the stage 6.5 m
  // off with its foot 0.3 m under the eyes, the view aimed a little under its middle.
  const camera = new PerspectiveCamera(60, 1440 / 900, 0.05, 200);
  camera.position.set(0, 1.15, 0);
  const stage = createStage({ parent: scene });
  stage.group.position.set(0, 1.15 - 0.3, -6.5);
  camera.lookAt(0, 1.15 - 0.3 + STAGE.height * 0.45 - 0.25, -6.5);
  void stage.play(chapter, { name: r.name });
  const tl = stage.timeline(chapter);
  const beat = Number(beatText);
  const t = beat === 0 ? 2.2 : (tl.beats[Math.min(beat, tl.beats.length) - 1]?.start ?? 0) + 2.6;
  stage.seek(t);
  renderer.render(scene, camera);
  void new Color();
}
