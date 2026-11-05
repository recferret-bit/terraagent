import type { ResourceField, ResourceKey } from '@terra/contracts';
import { nextFloat, seedStream } from '../../kernel/rng';
import { setBlob, type Blob, type PlanetState } from '../../kernel/state';
import type { ResolvedRegion, RegionContext } from './resolve';
import type { RegionView } from './sourcePolicy';

/**
 * Pinned regional endowment (ECON-GEO-02, W13-51). The resolved region and its `endowmentHash` are recorded in the planet
 * state ONCE, at first creation with W13 on. A planet without the blob (built before W13, or with W13 off) keeps legacy
 * behaviour forever; a planet with it keeps this endowment no matter what profile is active when it is loaded later.
 * Only the runtime fields (yields, renewal) may follow an audited activation, with their own `runtimeHash`.
 */
export const REGION_PIN_BLOB = 'regionEndowment';
export const REGION_RUNTIME_BLOB = 'regionRuntime';
/** Version of the W13 deposit composition applied at generation (stands in for a conditional `GEN_VERSION` bump). */
export const REGION_GEN_VERSION = 1;

type Fields = Readonly<Record<ResourceField, number>>;
export interface RegionPin {
  readonly v: 1;
  readonly regionGenVersion: number;
  readonly context: RegionContext;
  readonly endowmentHash: string;
  readonly runtimeHash: string;
  readonly depositDensityPer1000Tiles: number;
  readonly mainResource: ResourceKey | null;
  readonly resources: readonly { readonly resource: ResourceKey; readonly fields: Fields }[];
}

export interface RegionRuntime {
  readonly runtimeHash: string;
  readonly effectiveTick: number;
  readonly resources: readonly { readonly resource: ResourceKey; readonly extractionYieldBp: number; readonly renewableUnitsPerSimHour: number }[];
}

export function getRegionPin(state: PlanetState): RegionPin | undefined {
  return state.blobs[REGION_PIN_BLOB]?.value as RegionPin | undefined;
}

/**
 * Records `region` as the planet's endowment at FIRST CREATION (world generation calls this once). Never overwrites a pin,
 * and never pins a planet that has already run (tick > 0 or a colony): a world built without a region stays legacy.
 * Returns the pin in force, or `undefined` when the planet is not fresh and has none.
 */
export function writeRegionPin(state: PlanetState, region: ResolvedRegion, tick = 0): RegionPin | undefined {
  const existing = getRegionPin(state);
  if (existing) return existing;
  if (state.meta.tick > 0 || state.colonies.length > 0) return undefined;
  const pin: RegionPin = {
    v: 1, regionGenVersion: REGION_GEN_VERSION, context: { ...region.context }, endowmentHash: region.endowmentHash, runtimeHash: region.runtimeHash,
    depositDensityPer1000Tiles: region.depositDensityPer1000Tiles.value, mainResource: region.mainResource.value,
    resources: region.resources.map((r) => ({ resource: r.resource, fields: { ...r.fields } })),
  };
  setBlob(state, REGION_PIN_BLOB, pin, tick);
  return pin;
}

/** Audited runtime activation: yields/renewal of future production from `effectiveTick`; the endowment and stored cargo never change. */
export function activateRegionRuntime(state: PlanetState, region: ResolvedRegion, effectiveTick: number, tick = state.meta.tick): RegionRuntime | undefined {
  if (!getRegionPin(state)) return undefined;
  const rt: RegionRuntime = {
    runtimeHash: region.runtimeHash, effectiveTick,
    resources: region.resources.map((r) => ({ resource: r.resource, extractionYieldBp: r.fields.extractionYieldBp, renewableUnitsPerSimHour: r.fields.renewableUnitsPerSimHour })),
  };
  setBlob(state, REGION_RUNTIME_BLOB, rt, tick);
  return rt;
}

const viewCache = new WeakMap<Blob, RegionView>();

/** The region a source reads: pinned endowment fields plus the active runtime fields; `undefined` for an unpinned (legacy) planet. */
export function regionViewOf(state: PlanetState): RegionView | undefined {
  const pinBlob = state.blobs[REGION_PIN_BLOB];
  if (!pinBlob) return undefined;
  const rt = state.blobs[REGION_RUNTIME_BLOB]?.value as RegionRuntime | undefined;
  const active = rt && rt.effectiveTick <= state.meta.tick ? rt : undefined;
  if (!active) {
    let v = viewCache.get(pinBlob);
    if (!v) viewCache.set(pinBlob, (v = { resources: (pinBlob.value as RegionPin).resources }));
    return v;
  }
  const byKey = new Map(active.resources.map((r) => [r.resource, r]));
  return { resources: (pinBlob.value as RegionPin).resources.map((r) => ({ resource: r.resource, fields: { ...r.fields, ...(byKey.get(r.resource) ? { extractionYieldBp: byKey.get(r.resource)!.extractionYieldBp, renewableUnitsPerSimHour: byKey.get(r.resource)!.renewableUnitsPerSimHour } : {}) } })) };
}

/** `n` uniform draws in `[0, 1)` fixed by the tile's stable identity (planet seed, host salt, label, tile): repeat, cancel and reload never reroll. */
export function stableTileDraws(state: PlanetState, label: string, tileIdx: number, n: number): number[] {
  const rng = seedStream(`${state.meta.seed}|${state.meta.worldSalt ?? ''}`, `region:${label}:${tileIdx}`);
  return Array.from({ length: n }, () => nextFloat(rng));
}
