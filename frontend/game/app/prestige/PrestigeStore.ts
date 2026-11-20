import type { StakingPrestigeResponse } from '@terra/contracts/staking/performance';
import { prestigeVisualsForTier, type PrestigeVisuals } from '@terra/render/prestige/tierVisuals';
import { fetchPrestige } from './prestigeClient';

/** A planet's prestige is re-read after this long; inside it the cached answer (including "none") is used. */
export const PRESTIGE_TTL_MS = 60_000;

type Loader = (planetId: string) => Promise<StakingPrestigeResponse | null>;
interface Entry { at: number; value: StakingPrestigeResponse | null }

/**
 * Per-planet cache of the cosmetic prestige. One fetch per planet load (shared by the orbit menu and the colony
 * session), de-duplicated while in flight, and tolerant: a missing endpoint caches "none" for the TTL.
 */
export class PrestigeStore {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<StakingPrestigeResponse | null>>();
  private readonly listeners = new Set<(planetId: string) => void>();

  constructor(private readonly load: Loader = (id) => fetchPrestige(id), private readonly now: () => number = () => Date.now()) {}

  /** The cached answer: undefined = never loaded, null = loaded and none. */
  get(planetId: string): StakingPrestigeResponse | null | undefined {
    return this.entries.get(planetId)?.value;
  }

  /** Loads once per planet within the TTL. Always resolves (a failed load is "none"). */
  ensureLoaded(planetId: string): Promise<StakingPrestigeResponse | null> {
    const hit = this.entries.get(planetId);
    if (hit && this.now() - hit.at < PRESTIGE_TTL_MS) return Promise.resolve(hit.value);
    const pending = this.inflight.get(planetId);
    if (pending) return pending;
    const p = this.load(planetId)
      .catch(() => null)
      .then((value) => {
        this.entries.set(planetId, { at: this.now(), value });
        this.inflight.delete(planetId);
        for (const l of [...this.listeners]) l(planetId);
        return value;
      });
    this.inflight.set(planetId, p);
    return p;
  }

  /** Tier of one colony on a planet; 0 when unknown. */
  /** Tier of a colony by id, else by sim slot (`colonyIndex`) when the server's row id differs from the sim id. */
  tierOfColony(planetId: string, colonyId: string, colonyIndex?: number): number {
    const list = this.get(planetId)?.colonies ?? [];
    const byId = list.find((c) => c.colonyId === colonyId);
    if (byId) return byId.tier;
    return colonyIndex === undefined ? 0 : (list.find((c) => c.colonyIndex === colonyIndex)?.tier ?? 0);
  }

  visualsOfColony(planetId: string, colonyId: string): PrestigeVisuals {
    return prestigeVisualsForTier(this.tierOfColony(planetId, colonyId));
  }

  /** The planet's Lead Patron (King-of-the-Hill), or null. */
  leadPatron(planetId: string): StakingPrestigeResponse['leadPatron'] {
    return this.get(planetId)?.leadPatron ?? null;
  }

  onChange(cb: (planetId: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  clear(): void { this.entries.clear(); }
}

/** The page-wide store (menu and session share it). */
export const prestigeStore = new PrestigeStore();
