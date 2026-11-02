import type { HomeLandingHost } from '../../../src/core/home/home.service';

/**
 * A stand-in for the game's landing host in core-only apps (no sim threads): every colony index lands at `(index, 0)`
 * on its spawn slot `index`, and every home planet counts as loaded.
 */
export const freeLandingHost: HomeLandingHost = {
  landingSite: async (_planet, colonyIndex) => ({ ok: true, q: colonyIndex, r: 0, slotIndex: colonyIndex }),
  ensureHomeLoaded: async () => undefined,
};
