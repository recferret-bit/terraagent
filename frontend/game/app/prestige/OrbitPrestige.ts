import type { OrbitalStage } from '@terra/render/orbit/types';
import { isKnownPrestigeTier, prestigeVisualsForTier } from '@terra/render/prestige/tierVisuals';
import type { DescentPrestige } from '@terra/render/descent/types';
import { prestigeStore, type PrestigeStore } from './PrestigeStore';

/**
 * Keeps the orbit-menu skybox in step with the selected planet's prestige: the Lead Patron's named flagship carrier.
 * Driven by one cheap `step()` per menu frame; it loads (once per planet and TTL) only when the planet changes.
 */
export class OrbitPrestige {
  private key = '';
  private stage: OrbitalStage | null = null;
  private planetId: string | null = null;
  private off: (() => void) | null = null;
  /** The flagship name last handed to the stage (null = none), so a repeated answer does not re-set it. */
  private shown: string | null = null;

  constructor(
    private readonly isEnabled: () => boolean,
    private readonly store: PrestigeStore = prestigeStore,
  ) {}

  /** Call every menu frame with the stage and the selected planet's id (null when unknown). */
  step(stage: OrbitalStage | null, planetId: string | null): void {
    if (!stage || !planetId || !this.isEnabled()) {
      if (this.stage && this.key !== '') { this.stage.setLeadPatron?.(null); this.key = ''; this.shown = null; }
      this.stage = stage;
      this.planetId = null;
      return;
    }
    const key = planetId;
    if (stage === this.stage && key === this.key) return;
    this.stage = stage; this.key = key; this.planetId = planetId;
    stage.setLeadPatron?.(null);
    this.shown = null;
    this.off ??= this.store.onChange((id) => { if (id === this.planetId) this.apply(); });
    void this.store.ensureLoaded(planetId).then(() => this.apply());
  }

  private apply(): void {
    const { stage, planetId } = this;
    if (!stage || !planetId || this.key !== planetId) return;
    const name = this.store.leadPatron(planetId)?.carrierName ?? null;
    if (name === this.shown) return;
    this.shown = name;
    stage.setLeadPatron?.(name ? { carrierName: name } : null);
  }

  dispose(): void { this.off?.(); this.off = null; this.stage = null; }
}

/** Reads the linked NEAR account of the active pilot from `localStorage` (`null` for guests or non-browser tests). */
export function readStoredPilotAccount(): string | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ta_active_pilot') : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { accountId?: unknown; isGuest?: unknown };
    if (parsed.isGuest === true || typeof parsed.accountId !== 'string') return null;
    const acct = parsed.accountId.trim();
    return acct.length >= 2 ? acct : null;
  } catch {
    return null;
  }
}

async function defaultFetchWalletTier(accountId: string): Promise<number> {
  try {
    const res = await fetch(`/v1/near/staking/perks?accountId=${encodeURIComponent(accountId)}`);
    if (!res.ok) return 0;
    const body = (await res.json()) as { tier?: unknown };
    return isKnownPrestigeTier(body.tier) ? body.tier : 0;
  } catch {
    return 0;
  }
}

function createWalletTierReader(
  accountFn: () => string | null,
  loadTier: (accountId: string) => Promise<number>,
): () => number {
  let cachedAccount = '';
  let cachedTier = 0;
  let inflight = false;
  return () => {
    const acct = accountFn();
    if (!acct) {
      cachedAccount = '';
      cachedTier = 0;
      return 0;
    }
    if (acct !== cachedAccount && !inflight) {
      inflight = true;
      void loadTier(acct).then((tier) => {
        cachedAccount = acct;
        cachedTier = isKnownPrestigeTier(tier) ? tier : 0;
        inflight = false;
      });
    }
    return acct === cachedAccount ? cachedTier : 0;
  };
}

/**
 * The descent prestige of the player's own colony: a getter, evaluated every descent frame. When `own()` is `null`
 * (a wallet-first staker's very first drop-pod landing before founding a colony), falls back to the linked wallet's tier.
 */
export function ownDescentPrestige(
  own: () => { planetId: string; colonyId: string } | null,
  isEnabled: () => boolean,
  store: PrestigeStore = prestigeStore,
  devTier: number | null = null,
  walletTierFallback?: () => number,
): () => DescentPrestige | undefined {
  return () => {
    if (!isEnabled()) return undefined;
    if (devTier !== null) return prestigeVisualsForTier(devTier).plasmaTrail ? { plasmaTrail: true } : undefined;
    const c = own();
    if (!c) {
      const wt = walletTierFallback?.() ?? 0;
      return prestigeVisualsForTier(wt).plasmaTrail ? { plasmaTrail: true } : undefined;
    }
    void store.ensureLoaded(c.planetId);
    const v = prestigeVisualsForTier(store.tierOfColony(c.planetId, c.colonyId));
    return v.plasmaTrail ? { plasmaTrail: true } : undefined;
  };
}

/** What the orbit menu and the prepared descent need from the app (kept out of `Game.ts`, which sits at its line cap). */
export interface MenuPrestigeDeps {
  isLocalHost: () => boolean;
  /** The W28 wave flag (default-on before a welcome, as for every wave). */
  flagOn: () => boolean;
  activeColony: () => { planetId: string; colonyId: string } | null;
  pilotAccount?: () => string | null;
  fetchWalletTier?: (accountId: string) => Promise<number>;
}

export class MenuPrestige {
  readonly orbit: OrbitPrestige;
  /** Getter for `DescentOptions.prestige`: the player's own tier, read every descent frame. */
  readonly descent: () => DescentPrestige | undefined;

  constructor(deps: MenuPrestigeDeps, store: PrestigeStore = prestigeStore, search = typeof location !== 'undefined' ? location.search : '', dev = import.meta.env.DEV) {
    const enabled = () => deps.flagOn() && !deps.isLocalHost();
    const walletTier = createWalletTierReader(deps.pilotAccount ?? readStoredPilotAccount, deps.fetchWalletTier ?? defaultFetchWalletTier);
    this.orbit = new OrbitPrestige(enabled, store);
    this.descent = ownDescentPrestige(deps.activeColony, enabled, store, devStakeTier(search, dev), walletTier);
  }
}

/**
 * Dev QA only (`import.meta.env.DEV`): `/play.html?stakeTier=0..4` previews the own-tier descent trail without a staked
 * wallet. Anything else (and every production build) reads as no override.
 */
export function devStakeTier(search: string, dev: boolean): number | null {
  if (!dev) return null;
  const raw = new URLSearchParams(search).get('stakeTier');
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return isKnownPrestigeTier(n) ? n : null;
}
