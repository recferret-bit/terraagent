import type { ResourceFamily, ResourceKey } from '@terra/contracts';
import { compileData, type CompiledRow } from '../../data';
import { hexDistance, hexIndex } from '../../grid/hex';
import { DEPOSIT, PREP } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { creditResource } from '../economy/ledger';
import { colonyWho } from '../find';
import { depositFamilyAndKey } from '../harvest/adjacency';
import { colonyTerraformStats } from '../terraform-basic/rules';

export interface TierGateRowSpec {
  tier: 2 | 3;
  minTerraformPct: number;
  ringRadius: number;
  minRingTerraformedRatio: number;
  minRingLivingRatio: number;
  t1Share: number;
  t2Share: number;
  t3Share: number;
}

export interface ExtractorRingStats {
  ringRadius: number;
  totalTiles: number;
  terraformedTiles: number;
  livingTiles: number;
  terraformedRatio: number;
  livingRatio: number;
  terraformedPct: number;
  livingPct: number;
}

export interface ExtractorYieldShares {
  t1Share: number;
  t2Share: number;
  t3Share: number;
}

export interface ExtractorTierGateResult {
  enabled: boolean;
  unlockedTier: 1 | 2 | 3;
  colonyTerraformPct: number;
  colonyT2Open: boolean;
  colonyT3Open: boolean;
  ringT2Open: boolean;
  ringT3Open: boolean;
  ring: ExtractorRingStats;
  shares: ExtractorYieldShares;
}

export interface ColonyTierGateView {
  open: boolean;
  minTerraformPct: number;
  ringRadius: number;
  minRingTerraformedRatio: number;
  minRingTerraformedPct: number;
  minRingLivingRatio: number;
  minRingLivingPct: number;
  t1Share: number;
  t2Share: number;
  t3Share: number;
}

export interface ColonyTierGatesSummary {
  enabled: boolean;
  colonyTerraformPct: number;
  tier2: ColonyTierGateView;
  tier3: ColonyTierGateView;
}

interface RingCacheEntry {
  version: number;
  lastPathEpoch: number;
  hits: number;
  misses: number;
  byKey: Map<string, ExtractorRingStats>;
}

const ringCacheByState = new WeakMap<PlanetState, RingCacheEntry>();
const unlockedTiersByColony = new WeakMap<ColonyState, Set<string>>();

let cachedDefaultW05Data: CompiledDataLike | null = null;
function defaultW05Data(): CompiledDataLike {
  if (!cachedDefaultW05Data) {
    cachedDefaultW05Data = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W05']));
  }
  return cachedDefaultW05Data;
}

function parseGateRow(row: CompiledRow | undefined, fallback: TierGateRowSpec): TierGateRowSpec {
  if (!row) return fallback;
  return {
    tier: fallback.tier,
    minTerraformPct: typeof row.minTerraformPct === 'number' ? row.minTerraformPct : fallback.minTerraformPct,
    ringRadius: typeof row.ringRadius === 'number' ? Math.max(1, Math.round(row.ringRadius)) : fallback.ringRadius,
    minRingTerraformedRatio:
      typeof row.minRingTerraformedRatio === 'number' ? row.minRingTerraformedRatio : fallback.minRingTerraformedRatio,
    minRingLivingRatio:
      typeof row.minRingLivingRatio === 'number' ? row.minRingLivingRatio : fallback.minRingLivingRatio,
    t1Share: typeof row.t1Share === 'number' ? row.t1Share : fallback.t1Share,
    t2Share: typeof row.t2Share === 'number' ? row.t2Share : fallback.t2Share,
    t3Share: typeof row.t3Share === 'number' ? row.t3Share : fallback.t3Share,
  };
}

const DEFAULT_TIER2_GATE: TierGateRowSpec = {
  tier: 2,
  minTerraformPct: 30,
  ringRadius: 2,
  minRingTerraformedRatio: 0.5,
  minRingLivingRatio: 0,
  t1Share: 0.7,
  t2Share: 0.3,
  t3Share: 0,
};

const DEFAULT_TIER3_GATE: TierGateRowSpec = {
  tier: 3,
  minTerraformPct: 70,
  ringRadius: 2,
  minRingTerraformedRatio: 0.5,
  minRingLivingRatio: 0.5,
  t1Share: 0.5,
  t2Share: 0.3,
  t3Share: 0.2,
};

/**
 * Resolves the D-34 `tier2Gate` and `tier3Gate` data rows from `data` (tunable via `W00-59` / `D-35`).
 * When `data` is explicitly provided without `tables.terraform.tier2Gate` (e.g. `TA_WAVES=..04`), `enabled` is `false`.
 */
export function resolveTierGateSpecs(data?: CompiledDataLike): {
  enabled: boolean;
  tier2: TierGateRowSpec;
  tier3: TierGateRowSpec;
} {
  const effectiveData = data ?? defaultW05Data();
  const tfTable = effectiveData?.tables?.terraform as Record<string, CompiledRow> | undefined;
  const enabled = data ? Boolean(tfTable?.tier2Gate) : true;
  return {
    enabled,
    tier2: parseGateRow(tfTable?.tier2Gate, DEFAULT_TIER2_GATE),
    tier3: parseGateRow(tfTable?.tier3Gate, DEFAULT_TIER3_GATE),
  };
}

function ensureRingCache(state: PlanetState): RingCacheEntry {
  const epoch = state.meta.pathEpoch ?? 0;
  let entry = ringCacheByState.get(state);
  if (!entry) {
    entry = { version: 1, lastPathEpoch: epoch, hits: 0, misses: 0, byKey: new Map() };
    ringCacheByState.set(state, entry);
    return entry;
  }
  if (entry.lastPathEpoch !== epoch) {
    entry.version++;
    entry.lastPathEpoch = epoch;
    entry.byKey.clear();
  }
  return entry;
}

/**
 * Invalidates the cached extractor ring ratios for `state` (called when `tileStateChanged` emits, `W05-34`).
 */
export function invalidateExtractorRingCache(state: PlanetState): void {
  const entry = ringCacheByState.get(state);
  if (entry) {
    entry.version++;
    entry.lastPathEpoch = state.meta.pathEpoch ?? 0;
    entry.byKey.clear();
  }
}

/** Diagnostic helper for tests to verify ring ratio caching and invalidation on `tileStateChanged`. */
export function getExtractorRingCacheDiagnostics(state: PlanetState): {
  version: number;
  hits: number;
  misses: number;
  size: number;
} {
  const entry = ensureRingCache(state);
  return {
    version: entry.version,
    hits: entry.hits,
    misses: entry.misses,
    size: entry.byKey.size,
  };
}

function computeRingUncached(
  state: PlanetState,
  q: number,
  r: number,
  w: number,
  d: number,
  rot: number,
  ringRadius: number,
): ExtractorRingStats {
  const swap = rot % 2 !== 0;
  const fw = Math.max(1, swap ? d : w);
  const fd = Math.max(1, swap ? w : d);
  const idx = hexIndex(state.grid.radius);
  const prepLayer = state.grid.layers.prep as Uint8Array;

  const footprintCoords: Array<[number, number]> = [];
  const footprintIndices = new Set<number>();
  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      const fq = q + dq;
      const fr = r + dr;
      footprintCoords.push([fq, fr]);
      const fIdx = idx.indexOf(fq, fr);
      if (fIdx >= 0) footprintIndices.add(fIdx);
    }
  }

  let totalTiles = 0;
  let terraformedTiles = 0;
  let livingTiles = 0;

  for (let tr = r - ringRadius; tr <= r + fd - 1 + ringRadius; tr++) {
    for (let tq = q - ringRadius; tq <= q + fw - 1 + ringRadius; tq++) {
      const tIdx = idx.indexOf(tq, tr);
      if (tIdx < 0 || footprintIndices.has(tIdx)) continue;
      let minDist = Infinity;
      for (const [fq, fr] of footprintCoords) {
        const dist = hexDistance(tq, tr, fq, fr);
        if (dist < minDist) minDist = dist;
      }
      if (minDist < 1 || minDist > ringRadius) continue;
      totalTiles++;
      const prep = prepLayer[tIdx];
      if (prep === PREP.irrigated || prep === PREP.living) terraformedTiles++;
      if (prep === PREP.living) livingTiles++;
    }
  }

  const terraformedRatio = totalTiles > 0 ? terraformedTiles / totalTiles : 0;
  const livingRatio = totalTiles > 0 ? livingTiles / totalTiles : 0;
  return {
    ringRadius,
    totalTiles,
    terraformedTiles,
    livingTiles,
    terraformedRatio,
    livingRatio,
    terraformedPct: Number((terraformedRatio * 100).toFixed(1)),
    livingPct: Number((livingRatio * 100).toFixed(1)),
  };
}

/**
 * Returns the cached ring ratio (`PREP.irrigated` / `PREP.living` within `ringRadius` of the footprint `(w, d)` at `(q, r)`).
 * Refreshed automatically when `tileStateChanged` invalidates the cache (`W05-34`).
 */
export function getExtractorRingStats(
  state: PlanetState,
  q: number,
  r: number,
  w = 2,
  d = 2,
  rot = 0,
  ringRadius = 2,
): ExtractorRingStats {
  const cache = ensureRingCache(state);
  const key = `${q},${r},${w},${d},${rot},${ringRadius}`;
  const existing = cache.byKey.get(key);
  if (existing) {
    cache.hits++;
    return existing;
  }
  cache.misses++;
  const stats = computeRingUncached(state, q, r, w, d, rot, ringRadius);
  cache.byKey.set(key, stats);
  return stats;
}

/**
 * Computes the colony-level D-34 tier gate summary (`colonyTerraformPct`, `tier2`, `tier3`) exposed on `colony.tierGates`.
 */
export function computeColonyTierGates(
  state: PlanetState,
  colonyIndex: number,
  data?: CompiledDataLike,
): ColonyTierGatesSummary {
  const specs = resolveTierGateSpecs(data);
  const tfStats = colonyTerraformStats(state, colonyIndex);
  const pct = tfStats.percent;
  const t2Open = specs.enabled && pct + 1e-9 >= specs.tier2.minTerraformPct;
  const t3Open = specs.enabled && pct + 1e-9 >= specs.tier3.minTerraformPct;
  return {
    enabled: specs.enabled,
    colonyTerraformPct: pct,
    tier2: {
      open: t2Open,
      minTerraformPct: specs.tier2.minTerraformPct,
      ringRadius: specs.tier2.ringRadius,
      minRingTerraformedRatio: specs.tier2.minRingTerraformedRatio,
      minRingTerraformedPct: Number((specs.tier2.minRingTerraformedRatio * 100).toFixed(1)),
      minRingLivingRatio: specs.tier2.minRingLivingRatio,
      minRingLivingPct: Number((specs.tier2.minRingLivingRatio * 100).toFixed(1)),
      t1Share: specs.tier2.t1Share,
      t2Share: specs.tier2.t2Share,
      t3Share: specs.tier2.t3Share,
    },
    tier3: {
      open: t3Open,
      minTerraformPct: specs.tier3.minTerraformPct,
      ringRadius: specs.tier3.ringRadius,
      minRingTerraformedRatio: specs.tier3.minRingTerraformedRatio,
      minRingTerraformedPct: Number((specs.tier3.minRingTerraformedRatio * 100).toFixed(1)),
      minRingLivingRatio: specs.tier3.minRingLivingRatio,
      minRingLivingPct: Number((specs.tier3.minRingLivingRatio * 100).toFixed(1)),
      t1Share: specs.tier3.t1Share,
      t2Share: specs.tier3.t2Share,
      t3Share: specs.tier3.t3Share,
    },
  };
}

/**
 * Evaluates the D-34 resource tier gate for a single extractor at `(q, r)` with footprint `(w, d)`:
 * - T2 opens when colony Terraform % `>= tier2Gate.minTerraformPct` (`30`) and ring Irrigated+Living ratio `>= 0.5`.
 * - T3 opens when colony Terraform % `>= tier3Gate.minTerraformPct` (`70`) and ring Living ratio `>= 0.5`.
 * - Returns `unlockedTier` (`1 | 2 | 3`), `shares` (`70/30` or `50/30/20`), and cached `ring` stats.
 */
export function evaluateExtractorTierGate(
  state: PlanetState,
  colonyIndex: number,
  q: number,
  r: number,
  w = 2,
  d = 2,
  rot = 0,
  data?: CompiledDataLike,
): ExtractorTierGateResult {
  const specs = resolveTierGateSpecs(data);
  const tfStats = colonyTerraformStats(state, colonyIndex);
  const pct = tfStats.percent;
  const ring = getExtractorRingStats(state, q, r, w, d, rot, specs.tier2.ringRadius);

  const colonyT2Open = specs.enabled && pct + 1e-9 >= specs.tier2.minTerraformPct;
  const colonyT3Open = specs.enabled && pct + 1e-9 >= specs.tier3.minTerraformPct;
  const ringT2Open =
    specs.enabled &&
    ring.terraformedRatio + 1e-9 >= specs.tier2.minRingTerraformedRatio &&
    ring.livingRatio + 1e-9 >= specs.tier2.minRingLivingRatio;
  const ringT3Open =
    specs.enabled &&
    ring.terraformedRatio + 1e-9 >= specs.tier3.minRingTerraformedRatio &&
    ring.livingRatio + 1e-9 >= specs.tier3.minRingLivingRatio;

  let unlockedTier: 1 | 2 | 3 = 1;
  let shares: ExtractorYieldShares = { t1Share: 1, t2Share: 0, t3Share: 0 };
  if (colonyT3Open && ringT3Open) {
    unlockedTier = 3;
    shares = { t1Share: specs.tier3.t1Share, t2Share: specs.tier3.t2Share, t3Share: specs.tier3.t3Share };
  } else if (colonyT2Open && ringT2Open) {
    unlockedTier = 2;
    shares = { t1Share: specs.tier2.t1Share, t2Share: specs.tier2.t2Share, t3Share: specs.tier2.t3Share };
  }

  return {
    enabled: specs.enabled,
    unlockedTier,
    colonyTerraformPct: pct,
    colonyT2Open,
    colonyT3Open,
    ringT2Open,
    ringT3Open,
    ring,
    shares,
  };
}

/**
 * Emits `tierUnlocked` once per `(colony, extractorEntityId, tier)` when `unlockedTier` reaches `2` or `3` (`W05-34`).
 */
export function emitTierUnlockedIfNeeded(
  state: PlanetState,
  colony: ColonyState,
  owner: number,
  extractorEntityId: number,
  family: ResourceFamily,
  q: number,
  r: number,
  unlockedTier: 1 | 2 | 3,
  ctx?: StepContext,
): void {
  if (unlockedTier < 2) return;
  let seen = unlockedTiersByColony.get(colony);
  if (!seen) {
    seen = new Set<string>();
    unlockedTiersByColony.set(colony, seen);
  }
  const persisted = ((colony as { unlockedExtractorTiers?: Record<string, boolean> }).unlockedExtractorTiers ??= {});
  const { colonyIdStr, who } = colonyWho(state, owner);
  for (const tier of [2, 3] as const) {
    if (unlockedTier < tier) continue;
    const key = `${extractorEntityId}:${tier}`;
    if (seen.has(key) || persisted[key]) continue;
    seen.add(key);
    persisted[key] = true;
    colony.changedAt = ctx?.tick ?? state.meta.tick;
    ctx?.emit?.({
      kind: 'tierUnlocked',
      severity: 'info',
      colonyIds: [colonyIdStr],
      data: {
        ...who,
        family,
        tier,
        extractorEntityId,
        q,
        r,
      },
    });
  }
}

/**
 * Credits `got` units extracted from a deposit tile with `depositTier` (`0 = legacy T1`, `1..3`) using the D-34 yield split
 * when `tierGate.unlockedTier >= 2` on a T1 deposit (`DEPOSIT.metals` or `DEPOSIT.minerals`).
 */
export function creditExtractedDepositSlice(
  colony: ColonyState,
  depositKind: number,
  depositTier: number,
  got: number,
  tick: number,
  tierGate?: ExtractorTierGateResult,
  fallbackKey?: ResourceKey,
  out: Map<ResourceKey, number> = new Map(),
): Map<ResourceKey, number> {
  if (got <= 0) return out;
  const isSplittableFamily = depositKind === DEPOSIT.metals || depositKind === DEPOSIT.minerals;
  if (isSplittableFamily && depositTier <= 1 && tierGate && tierGate.unlockedTier >= 2) {
    const { t1Share, t2Share, t3Share } = tierGate.shares;
    const parts: Array<[1 | 2 | 3, number]> = [
      [1, t1Share],
      [2, t2Share],
      [3, t3Share],
    ];
    for (const [shareTier, share] of parts) {
      if (share <= 0) continue;
      const slice = got * share;
      const key = depositFamilyAndKey(depositKind, shareTier)!.key;
      creditResource(colony, key, slice, tick);
      out.set(key, (out.get(key) ?? 0) + slice);
    }
    return out;
  }

  const key =
    fallbackKey && depositKind === DEPOSIT.oil && depositTier !== 3
      ? fallbackKey
      : depositFamilyAndKey(depositKind, depositTier)!.key;
  creditResource(colony, key, got, tick);
  out.set(key, (out.get(key) ?? 0) + got);
  return out;
}
