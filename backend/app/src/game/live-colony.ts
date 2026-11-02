import type { PlanetState } from '@terra/sim';

/** The planet has at least one colony that is not eliminated (scenario planets: colony 0 is playable). */
export function hasLiveColony(state: Pick<PlanetState, 'colonies'> | null | undefined): boolean {
  return state?.colonies?.some((c) => c.status !== 'eliminated') ?? false;
}
