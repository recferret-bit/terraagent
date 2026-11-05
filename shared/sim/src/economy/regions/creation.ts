import type { ParamValue, RegionsContent } from '@terra/contracts';
import { resolvePlanetRegion } from './planetRegion';
import type { RegionContext, ResolvedRegion } from './resolve';

/** The wave whose planets carry a pinned regional endowment (ECON-GEO-02). */
export const REGION_WAVE = 'W13';

export interface NewPlanetRegionInput {
  /** The wave flags the planet will run with: W13 off means no region and generation is unchanged. */
  readonly flags: Iterable<string>;
  /** The planet's `createPlanet` identity (`planetType` default `temperate`, `planetId` default `pl_dev`). */
  readonly planetType?: string;
  readonly planetId?: string;
  /** Active profile content (server: `EconomyProfileService` layers; local host / CLI: none = the bootstrap tables). */
  readonly content?: { readonly parameters?: Readonly<Record<string, ParamValue>>; readonly regions?: RegionsContent };
}

/**
 * The ONE decision "does a new planet get a regional endowment" (D-31; server planet creation, scenario loader and the
 * browser local host all call it). With W13 on, the active profile's single planet region (pre-W11: no sector) is resolved
 * for the planet type/id; with W13 off, `undefined` and nothing changes. A profile that does not resolve is a hard error:
 * a planet is never silently created with a different endowment than the operator configured.
 * Only for FIRST creation: an existing planet keeps its pin (`writeRegionPin` never overwrites).
 */
export function regionForNewPlanet(input: NewPlanetRegionInput): ResolvedRegion | undefined {
  if (![...input.flags].includes(REGION_WAVE)) return undefined;
  const ctx: RegionContext = { planetType: input.planetType ?? 'temperate', planetId: input.planetId ?? 'pl_dev' };
  const res = resolvePlanetRegion(input.content ?? {}, ctx);
  if (!res.ok) throw new Error(`regional endowment of ${ctx.planetType}/${ctx.planetId} does not resolve: ${res.errors.map((e) => e.message).join('; ')}`);
  return res.region;
}
