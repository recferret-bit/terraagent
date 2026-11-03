import * as THREE from 'three';
import type { ShoreField } from '../shoreField';
import { getFaunaDensity, onWaterChange } from '../waterConfig';
import { buildFishGeometry } from './fishGeometry';
import { createFishMaterial } from './fishMaterial';
import { FAUNA_CAP, createFaunaBuffers, layoutFauna, visibleFishCount, type FaunaLayout } from './faunaPlacement';
import { createFaunaSink } from './faunaSink';
import { fishBounds, jellyBounds } from './faunaBounds';
import { createFaunaBucketSet } from './faunaBuckets';
import { buildJellyGeometry } from './jellyGeometry';
import { createJellyMaterial } from './jellyMaterial';
import { JELLY_CAP, createJellyBuffers, layoutJellies, visibleJellyCount } from './jellyPlacement';

/**
 * Water fauna: fish (<= FAUNA_CAP, opaque) and jellyfish (<= JELLY_CAP, translucent, deep water only), no shadows,
 * animated entirely on the GPU. Each kind is split into 64 m world cells by loop centre (`faunaBuckets.ts`): one
 * InstancedMesh per cell whose bounds cover every placed loop in it (`faunaBounds.ts`), so three frustum-culls the
 * fauna of off-screen water per cell and `cullToFocus` hides cells off the view focus. The CPU writes the instance
 * attributes only when the shore field is rebuilt; F8 density changes only `count`s. Both swim deeper as the waves
 * grow (`faunaSink.ts`, one eased uniform stepped in the meshes' `onBeforeRender`).
 */
export interface WaterFauna {
  /** Parent of every fauna mesh (add this to the scene). */
  readonly group: THREE.Group;
  /** Fish cell meshes (ordered by cell key). */
  readonly fish: readonly THREE.InstancedMesh[];
  /** Jellyfish cell meshes (ordered by cell key). */
  readonly jellies: readonly THREE.InstancedMesh[];
  /** Jellies drawn at the current density. */
  readonly jellyCount: number;
  /** Fish drawn at the current density. */
  readonly count: number;
  /** Fish placed (sized for the maximum density). */
  readonly placed: number;
  /** Re-places the fish from a freshly baked field. */
  rebuild(field: ShoreField): void;
  /** Hides each cell mesh whose bounds lie wholly outside the view focus (`core/viewFocus.ts`); call once per frame. */
  cullToFocus(): void;
  dispose(): void;
}

export interface WaterFaunaOptions {
  /** The water's `uTime` IUniform (advanced by the terrain tick, so fish pause with the game). */
  time: THREE.IUniform;
  /** The water's deep colour IUniform (underwater tint). */
  deepColor: THREE.IUniform;
  seed: number;
}

export function createWaterFauna(opts: WaterFaunaOptions): WaterFauna {
  const sink = createFaunaSink();
  const step = () => sink.step(); // dt is measured, so being called by several meshes in one frame is harmless
  const group = new THREE.Group();
  group.name = 'waterFaunaGroup';
  const owned = {
    fishGeo: buildFishGeometry(), fishMat: createFishMaterial(opts.time, opts.deepColor, sink.uniform),
    jellyGeo: buildJellyGeometry(), jellyMat: createJellyMaterial(opts.time, opts.deepColor, sink.uniform),
  };
  const fishBuf = createFaunaBuffers(FAUNA_CAP);
  const fish = createFaunaBucketSet(group, {
    name: 'waterFauna', geometry: owned.fishGeo, material: owned.fishMat, buffers: fishBuf, attrs: { aSwim: 'swim', aFish: 'fish', aOffset: 'offset' }, centre: 'swim', bounds: fishBounds, onFrame: step,
  });
  const jellyBuf = createJellyBuffers(JELLY_CAP);
  const jellies = createFaunaBucketSet(group, {
    name: 'waterJellies', geometry: owned.jellyGeo, material: owned.jellyMat, buffers: jellyBuf, attrs: { aDrift: 'drift', aJelly: 'jelly' }, centre: 'drift', bounds: jellyBounds, onFrame: step,
  });
  let layout: FaunaLayout | null = null;
  let jellyPlaced = 0;

  const applyDensity = () => {
    const d = getFaunaDensity();
    fish.setCount(layout ? visibleFishCount(layout, d) : 0);
    jellies.setCount(visibleJellyCount(jellyPlaced, d));
  };
  const unsubscribe = onWaterChange(applyDensity);

  return {
    group,
    get fish() { return fish.meshes; },
    get jellies() { return jellies.meshes; },
    get count() { return fish.count; },
    get jellyCount() { return jellies.count; },
    get placed() { return layout?.placed ?? 0; },
    rebuild(field) {
      layout = layoutFauna(field, opts.seed, fishBuf, FAUNA_CAP);
      jellyPlaced = layoutJellies(field, opts.seed, jellyBuf, JELLY_CAP);
      fish.rebuild(layout.placed);
      jellies.rebuild(jellyPlaced);
      applyDensity();
    },
    cullToFocus() { fish.cullToFocus(); jellies.cullToFocus(); },
    dispose() {
      unsubscribe();
      group.removeFromParent();
      fish.dispose();
      jellies.dispose();
      for (const o of Object.values(owned)) o.dispose();
    },
  };
}
