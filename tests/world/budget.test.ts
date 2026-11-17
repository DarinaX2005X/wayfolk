import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, type Mesh, type WebGLRenderer } from '@iwsdk/core';
import { Batch } from '../../src/world/batch';
import { Packer, ViewCone } from '../../src/world/cull';
import { blob, join, paint } from '../../src/world/geo';
import { simplify } from '../../src/world/lod';
import { bendAt, whaleGeometry } from '../../src/world/whale';
import { createWorld } from '../../src/world/index';

const bush = () => join([paint(blob(0.6, 3, 1, 0.1), '#5d9a40', {}, true), paint(blob(0.4, 3, 2, 0.1).translate(0.5, 0, 0), '#6faa48', {}, true)]);

describe('far versions', () => {
  it('simplify keeps the layout and drops small shapes', () => {
    const g = bush();
    const s = simplify(g, 0.2);
    const n0 = g.getAttribute('position').count;
    const n1 = s.getAttribute('position').count;
    expect(n1).toBeLessThan(n0 * 0.6);
    expect(n1 % 3).toBe(0);
    expect(s.getAttribute('color').itemSize).toBe(4);
    expect(s.getAttribute('normal').count).toBe(n1);
    // stays the same size
    s.computeBoundingSphere();
    g.computeBoundingSphere();
    expect(Math.abs(s.boundingSphere!.radius - g.boundingSphere!.radius)).toBeLessThan(0.15);
  });

  it('a batch swaps an entry to its far version by distance', () => {
    const b = new Batch('t', new MeshBasicMaterial());
    b.add('bush', bush().translate(10, 0, 0));
    b.lod('bush', 0.2, 8);
    b.flush();
    const full = b.triangles();
    b.updateLod(10, 0);
    b.flush();
    expect(b.triangles()).toBe(full);
    b.updateLod(-10, 0);
    b.flush();
    expect(b.triangles()).toBeLessThan(full * 0.7);
    expect(b.mesh.geometry.getAttribute('position').count).toBe(b.triangles() * 3);
    b.remove('bush');
    b.flush();
    expect(b.triangles()).toBe(0);
  });
});

describe('culling', () => {
  it('the view cone sees what is in front and not what is behind', () => {
    const cam = new PerspectiveCamera(70, 1.5, 0.1, 100);
    cam.position.set(0, 1.2, 0);
    cam.lookAt(0, 1.2, -10);
    cam.updateMatrixWorld(true);
    const scene = new Scene();
    scene.updateMatrixWorld(true);
    const cone = new ViewCone();
    expect(cone.sees(0, 0, 50, 1)).toBe(true);
    cone.set(cam, scene);
    expect(cone.sees(0, 1, -20, 1)).toBe(true);
    expect(cone.sees(0, 1, 20, 1)).toBe(false);
    expect(cone.sees(30, 1, -1, 1)).toBe(false);
    expect(cone.sees(30, 1, -1, 40)).toBe(true);
  });

  it('the packer draws a chosen subset of instances', () => {
    const geo = blob(1, 0, 1);
    const mesh = new InstancedMesh(geo, new MeshBasicMaterial(), 5);
    for (let i = 0; i < 5; i++) mesh.setMatrixAt(i, new Matrix4().makeTranslation(i, 0, 0));
    const p = new Packer(mesh, 5);
    p.show([4, 1], 2, 'a');
    expect(mesh.count).toBe(2);
    expect(mesh.instanceMatrix.array[12]).toBe(4);
    expect(mesh.instanceMatrix.array[16 + 12]).toBe(1);
  });

  it('the world draws only the grass and clouds in view, thinner far away', async () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(72, 1.6, 0.05, 1600);
    const world = createWorld({ scene, camera }, { kitUrl: 'missing.glb' });
    await world.ready;
    world.update(0);
    const all = world.stats().parts;
    // a camera at the seat looking out to the pier: the sky dome's render hook drives culling
    camera.position.set(0, 1.2, 0);
    camera.lookAt(new Vector3(9, 0.3, -9));
    scene.updateMatrixWorld(true);
    const dome = world.root.getObjectByName('world:sky') as Mesh;
    const renderer = { info: { render: { frame: 7 } }, xr: { isPresenting: false } } as unknown as WebGLRenderer;
    dome.onBeforeRender(renderer, scene, camera, dome.geometry, dome.material as never, null as never);
    const seen = world.stats().parts;
    expect(seen.meadow).toBeGreaterThan(0);
    expect(seen.meadow).toBeLessThan(all.meadow * 0.85);
    expect(seen.clouds).toBeLessThan(all.clouds * 0.7);
  });
});

describe('the sky whale', () => {
  it('has a body, fins and flukes that swim', () => {
    const g = whaleGeometry();
    g.computeBoundingBox();
    const box = g.boundingBox!;
    // about 26 m from flukes to nose, flukes wider than the body
    expect(box.max.x - box.min.x).toBeGreaterThan(24);
    expect(box.max.z - box.min.z).toBeGreaterThan(8);
    expect(g.getAttribute('aSwim').itemSize).toBe(3);
    expect(g.index!.count / 3).toBeLessThan(6000);
    expect(bendAt(10)).toBe(0);
    expect(bendAt(-12.5)).toBeCloseTo(1, 5);
  });
});
