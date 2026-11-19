import * as THREE from 'three';
import type { ShoreField } from '../shoreField';
import { getFaunaDensity, onWaterChange } from '../waterConfig';
import { buildFishGeometry } from './fishGeometry';
import { createFishMaterial } from './fishMaterial';
import {
  createAquaticThreatUniforms,
  MAX_AQUATIC_THREATS,
  type AquaticThreatZone,
} from './faunaWater';
import { FAUNA_CAP, createFaunaBuffers, layoutFauna, planetFishCap, visibleFishCount, type FaunaLayout } from './faunaPlacement';
import { createFaunaSink } from './faunaSink';
import { fishBounds, jellyBounds } from './faunaBounds';
import { createFaunaBucketSet } from './faunaBuckets';
import { buildJellyGeometry } from './jellyGeometry';
import { createJellyMaterial } from './jellyMaterial';
import { JELLY_CAP, createJellyBuffers, layoutJellies, planetJellyCap, visibleJellyCount } from './jellyPlacement';

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
  /** Updates active aggressor / battle / shoreline-disturbance threat zones so fish & jellies scatter and dive. */
  setThreats(threats: readonly AquaticThreatZone[]): void;
  /** Current active aquatic threat zones (`<= MAX_AQUATIC_THREATS`). */
  getThreats(): readonly AquaticThreatZone[];
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
  /** Optional world span (m) to scale planet-wide aquatic caps beyond the 64 m test cap. */
  planetSpan?: number;
  /** Optional planet biome kind ('oceanForest' | 'forestRock' | 'dune') for endemic aquatic palettes. */
  biomeKind?: string;
}

export function createWaterFauna(opts: WaterFaunaOptions): WaterFauna {
  const fishCap = opts.planetSpan ? planetFishCap(opts.planetSpan) : FAUNA_CAP;
  const jellyCap = opts.planetSpan ? planetJellyCap(opts.planetSpan) : JELLY_CAP;
  const sink = createFaunaSink();
  const threatUniforms = createAquaticThreatUniforms();
  let activeThreats: AquaticThreatZone[] = [];
  const step = () => sink.step(); // dt is measured, so being called by several meshes in one frame is harmless
  const group = new THREE.Group();
  group.name = 'waterFaunaGroup';
  const owned = {
    fishGeo: buildFishGeometry(), fishMat: createFishMaterial(opts.time, opts.deepColor, sink.uniform, opts.biomeKind, threatUniforms),
    jellyGeo: buildJellyGeometry(), jellyMat: createJellyMaterial(opts.time, opts.deepColor, sink.uniform, threatUniforms),
  };
  const fishBuf = createFaunaBuffers(fishCap);
  const fish = createFaunaBucketSet(group, {
    name: 'waterFauna', geometry: owned.fishGeo, material: owned.fishMat, buffers: fishBuf, attrs: { aSwim: 'swim', aFish: 'fish', aOffset: 'offset', aEvade: 'evade' }, centre: 'swim', bounds: fishBounds, onFrame: step,
  });
  const jellyBuf = createJellyBuffers(jellyCap);
  const jellies = createFaunaBucketSet(group, {
    name: 'waterJellies', geometry: owned.jellyGeo, material: owned.jellyMat, buffers: jellyBuf, attrs: { aDrift: 'drift', aJelly: 'jelly', aEvade: 'evade' }, centre: 'drift', bounds: jellyBounds, onFrame: step,
  });
  let layout: FaunaLayout | null = null;
  let jellyPlaced = 0;

  const applyDensity = () => {
    const d = getFaunaDensity();
    fish.setCount(layout ? visibleFishCount(layout, d, fishCap) : 0);
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
      layout = layoutFauna(field, opts.seed, fishBuf, fishCap);
      jellyPlaced = layoutJellies(field, opts.seed, jellyBuf, jellyCap);
      fish.rebuild(layout.placed);
      jellies.rebuild(jellyPlaced);
      applyDensity();
    },
    setThreats(threats) {
      const count = Math.min(MAX_AQUATIC_THREATS, threats.length);
      activeThreats = threats.slice(0, count).map((t) => ({ ...t }));
      threatUniforms.uThreatCount.value = count;
      const vecs = threatUniforms.uThreatZones.value;
      for (let i = 0; i < MAX_AQUATIC_THREATS; i++) {
        const tz = activeThreats[i];
        if (tz) vecs[i]!.set(tz.x, tz.z, tz.radius, tz.strength);
        else vecs[i]!.set(0, 0, 0, 0);
      }
    },
    getThreats: () => activeThreats,
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
