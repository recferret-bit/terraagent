import type { PlanetState } from '@terra/sim';

/** The planet has at least one colony that is not eliminated (scenario planets: colony 0 is playable). */
export function hasLiveColony(state: Pick<PlanetState, 'colonies'> | null | undefined): boolean {
  return state?.colonies?.some((c) => c.status !== 'eliminated') ?? false;
}

/** Indices of the colonies that are not eliminated, ascending (scenario planets: the seats dev sessions can take). */
export function liveColonyIndices(state: Pick<PlanetState, 'colonies'> | null | undefined): number[] {
  return (state?.colonies ?? []).filter((c) => c.status !== 'eliminated').map((c) => c.index).sort((a, b) => a - b);
}
