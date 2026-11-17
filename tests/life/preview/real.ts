// Life on the real island from src/world: the same moments as the stand-in shots.
import { PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from '@iwsdk/core';
import { createLife } from '../../../src/life/index';
import type { Life, LifeWorld } from '../../../src/life/types';
import type { HouseSpec } from '../../../src/mind/types';
import { createWorld } from '../../../src/world/index';
import { RESIDENTS } from './fixtures';
import { createHand } from './standin';

export async function realShot(shot: string, renderer: WebGLRenderer, camera: PerspectiveCamera): Promise<{ scene: Scene; life: Life }> {
  const scene = new Scene();
  scene.add(camera);
  const world = createWorld({ scene, camera, renderer });
  await world.ready;
  world.setTime(new Date('2026-11-17T18:40:00'));
  const life = createLife({ scene, camera }, world as unknown as LifeWorld);
  await life.ready;
  const eye = world.seat.pos.clone().add(new Vector3(0, 1.05, 0.05));
  camera.position.copy(eye);
  camera.lookAt(eye.clone().add(new Vector3(0, -0.15, -1)));
  let t = 0;
  const run = (seconds: number, at?: (t: number) => void): void => {
    const end = t + seconds;
    while (t < end) {
      t += 1 / 60;
      at?.(t);
      world.update(t * 1000);
      life.update(1 / 60, t);
    }
  };
  const look = (p: Vector3, fov: number): void => {
    camera.position.copy(eye);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(p);
  };
  switch (shot) {
    case 'real-pip': {
      const { group, palm } = createHand();
      group.position.copy(eye).add(new Vector3(0.12, -0.36, -0.36));
      group.rotation.set(0.25, -0.35, 0.1);
      scene.add(group);
      run(0.5);
      void life.pip.landOn(palm);
      run(4);
      void life.pip.say('Hello. I am Pip. This little island is yours now.');
      run(1.1);
      look(group.position.clone().add(new Vector3(0, 0.1, 0)), 62);
      break;
    }
    case 'real-talk': {
      const res = RESIDENTS[0];
      const meet = world.root.localToWorld(world.seat.meet.clone());
      life.spawn(res, { x: meet.x, z: meet.z });
      life.face(res.id);
      run(1.5);
      void life.say(res.id, 'I came on the evening wind. Do you have room for a baker?', { mood: 'curious' });
      run(1.25);
      look(meet.clone().setY(meet.y + 0.6), 40);
      break;
    }
    case 'real-arrive': {
      const res = { ...RESIDENTS[3], vehicle: 'balloon' as const };
      run(0.5);
      void life.arrive(res, 'balloon');
      run(10.8);
      const dock = world.root.localToWorld(world.pier.step.clone());
      look(dock.clone().setY(dock.y + 1.0), 30);
      break;
    }
    case 'real-build': {
      const spot = world.suggestSpot();
      const spec: HouseSpec = { id: 'h-juniper', residentId: 'r0', recipe: 'baker', pos: { x: spot.snapped.x, z: spot.snapped.z }, rotY: spot.rotY, colors: { wall: '#f2dcc0', roof: '#c8553d', trim: '#7b4b2e' }, props: [], sign: 'Bread', builtAt: 0 };
      const steps = world.buildPlan(spec);
      const { group, palm } = createHand();
      group.position.copy(eye).add(new Vector3(0.45, -0.6, 0.1));
      scene.add(group);
      void life.pip.landOn(palm);
      run(0.5);
      void life.build(steps as never);
      run(9);
      const at = world.root.localToWorld(new Vector3(spot.snapped.x, 1.6, spot.snapped.z));
      look(at, 48);
      break;
    }
    case 'real-flock': {
      const spot = world.suggestSpot();
      RESIDENTS.slice(0, 5).forEach((r, i) => {
        const a = (i / 5) * Math.PI * 1.2 - 0.6;
        life.spawn(r, { x: spot.snapped.x * 0.4 + Math.sin(a) * 4, z: -4 - Math.cos(a) * 3 });
      });
      life.startDaily();
      run(20);
      look(eye.clone().add(new Vector3(0, 0.1, -3)), 62);
      break;
    }
  }
  return { scene, life };
}
