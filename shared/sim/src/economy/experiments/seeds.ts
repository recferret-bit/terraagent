import type { ExperimentManifest } from '@terra/contracts';

/** Every seed an experiment runs: the tuning seeds, then the held-out seeds. */
export const plannedSeeds = (m: Pick<ExperimentManifest, 'seeds' | 'heldOutSeeds'>): number[] => [...m.seeds, ...(m.heldOutSeeds ?? [])];
export const isHeldOutSeed = (m: Pick<ExperimentManifest, 'heldOutSeeds'>, seed: number): boolean => (m.heldOutSeeds ?? []).includes(seed);
