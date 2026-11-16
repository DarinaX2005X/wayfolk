/**
 * Shared types of the craft kit pages (PLAN "Набор ремесла"): a gallery entry is one
 * component with all its states side by side. `build` returns a 3D object (a panel, an
 * object of the world) or an HTML element (a browser control); the gallery lays the
 * states out in a row with their names.
 */
import type { Object3D, World } from '@iwsdk/core';
import type { App } from '../../app/boot/world';

export type GalleryState = { name: string; build(ctx: { world: World; app: App }): Object3D | HTMLElement };
export type GalleryEntry = { id: string; title: string; states: GalleryState[] };

/**
 * An object built for the gallery may expose `userData.at(t)`: the gallery's time slider
 * calls it to hold every animation at one instant (t in seconds).
 */
export type TimeHook = (t: number) => void;
