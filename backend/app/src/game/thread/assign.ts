import { hashString } from '@terra/sim';

/** Planet → sim thread (SIM-H-01): stable FNV-1a of the planet id modulo the thread count. Deterministic across restarts. */
export function threadOf(planetId: string, threads: number): number {
  return hashString(planetId) % threads;
}

/** Wave flags on until the flags issue lands: W00..W20. */
export const ALL_WAVES: readonly string[] = Array.from({ length: 21 }, (_, i) => `W${String(i).padStart(2, '0')}`);
