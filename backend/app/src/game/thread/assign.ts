import { hashString } from '@terra/sim';

/**
 * Stable FNV-1a of the planet id modulo `threads`. NOT the routing (the pool's placement table places planets by
 * measured load); kept to generate deterministic dev planet ids (`devPlanetIds`) that existing databases already hold.
 */
export function hashThread(planetId: string, threads: number): number {
  return hashString(planetId) % threads;
}
