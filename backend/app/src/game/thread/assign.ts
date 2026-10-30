import { hashString } from '@terra/sim';

/** Planet → sim thread (SIM-H-01): stable FNV-1a of the planet id modulo the thread count. Deterministic across restarts. */
export function threadOf(planetId: string, threads: number): number {
  return hashString(planetId) % threads;
}
