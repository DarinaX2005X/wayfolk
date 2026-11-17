/**
 * Culling for instanced things the renderer cannot cull one by one (grass, flowers, cloud
 * puffs): a view cone from the camera, and a packer that moves the instances in view to the
 * front of an InstancedMesh and draws only those. The packer rewrites the buffers only when
 * the set in view changes.
 */
import { InstancedBufferAttribute, Matrix4, Vector3, type Camera, type InstancedMesh, type Object3D, type PerspectiveCamera, type WebGLRenderer } from '@iwsdk/core';

/** Half-angle of the cone round a headset's view (both eyes, corners, a little head turn). */
const XR_HALF = (66 * Math.PI) / 180;

export class ViewCone {
  /** Viewer position and view direction in world.root space. */
  readonly eye = new Vector3();
  readonly dir = new Vector3(0, 0, -1);
  half = Math.PI;
  /** False until a camera has been seen: then everything counts as in view. */
  active = false;
  private inv = new Matrix4();
  private tmp = new Vector3();

  set(camera: Camera, root: Object3D, renderer?: WebGLRenderer): void {
    camera.getWorldPosition(this.eye);
    root.worldToLocal(this.eye);
    camera.getWorldDirection(this.dir);
    this.inv.copy(root.matrixWorld).invert();
    this.dir.transformDirection(this.inv);
    if (renderer?.xr?.isPresenting) this.half = XR_HALF;
    else {
      const cam = camera as PerspectiveCamera;
      if (cam.isPerspectiveCamera) {
        const tv = Math.tan(((cam.fov ?? 70) * Math.PI) / 360);
        const th = tv * (cam.aspect ?? 1);
        this.half = Math.atan(Math.hypot(tv, th)) + 0.08;
      } else this.half = Math.PI;
    }
    this.active = true;
  }

  /** Whether a sphere at (x, y, z) of radius r is (partly) inside the cone. */
  sees(x: number, y: number, z: number, r: number): boolean {
    if (!this.active || this.half >= Math.PI) return true;
    const v = this.tmp.set(x - this.eye.x, y - this.eye.y, z - this.eye.z);
    const d = v.length();
    if (d <= r) return true;
    const along = v.dot(this.dir) / d;
    const ang = Math.acos(Math.max(-1, Math.min(1, along)));
    return ang - Math.asin(Math.min(1, r / d)) < this.half;
  }

  distance(x: number, z: number): number {
    return Math.hypot(x - this.eye.x, z - this.eye.z);
  }
}

/**
 * Keeps a full copy of an InstancedMesh's per-instance data and draws a chosen subset by
 * packing it to the front. Extra per-instance attributes (InstancedBufferAttribute on the
 * geometry) are packed along with the matrices and colours.
 */
export class Packer {
  private mats: Float32Array;
  private cols: Float32Array | null;
  private extras: { attr: InstancedBufferAttribute; src: Float32Array }[];
  private last = '';
  readonly total: number;

  constructor(readonly mesh: InstancedMesh, total = mesh.count) {
    this.total = total;
    this.mats = Float32Array.from(mesh.instanceMatrix.array.subarray(0, total * 16));
    this.cols = mesh.instanceColor ? Float32Array.from(mesh.instanceColor.array.subarray(0, total * 3)) : null;
    this.extras = [];
    for (const attr of Object.values(mesh.geometry.attributes))
      if ((attr as InstancedBufferAttribute).isInstancedBufferAttribute) {
        const a = attr as InstancedBufferAttribute;
        this.extras.push({ attr: a, src: Float32Array.from(a.array as Float32Array) });
      }
    mesh.frustumCulled = false;
  }

  /** Draws the instances listed (indices into the full set), in that order. `key` identifies the set. */
  show(list: ArrayLike<number>, n: number, key: string): void {
    if (key === this.last) return;
    this.last = key;
    const dst = this.mesh.instanceMatrix.array as Float32Array;
    const cdst = this.mesh.instanceColor?.array as Float32Array | undefined;
    for (let k = 0; k < n; k++) {
      const i = list[k];
      dst.set(this.mats.subarray(i * 16, i * 16 + 16), k * 16);
      if (this.cols && cdst) cdst.set(this.cols.subarray(i * 3, i * 3 + 3), k * 3);
      for (const e of this.extras) {
        const s = e.attr.itemSize;
        (e.attr.array as Float32Array).set(e.src.subarray(i * s, i * s + s), k * s);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, Math.max(1, n) * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
    for (const e of this.extras) {
      e.attr.clearUpdateRanges();
      e.attr.addUpdateRange(0, Math.max(1, n) * e.attr.itemSize);
      e.attr.needsUpdate = true;
    }
  }

  /** Re-reads every matrix from the mesh after the caller rewrote all of them in full order. */
  reloadMatrices(): void {
    this.mats.set(this.mesh.instanceMatrix.array.subarray(0, this.total * 16));
    this.last = '';
  }

  /** Matrix of instance i of the full set. */
  matrixAt(i: number): Float32Array {
    return this.mats.subarray(i * 16, i * 16 + 16);
  }

  /** Replaces the stored matrix of instance i (call show again to draw it). */
  setMatrix(i: number, m: Matrix4): void {
    m.toArray(this.mats, i * 16);
    this.last = '';
  }

  extra(i: number, attr: number): number {
    const e = this.extras[attr];
    return e ? e.src[i * e.attr.itemSize] : 0;
  }
}
