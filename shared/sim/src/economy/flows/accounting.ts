import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import type { PostingInput } from '@terra/ledger';
import { colonyIndexOfAccount, isSystemAccount } from '../accounts';
import type { FlowWindow } from './metric';

/** Where added resources come from. Starter grants and subsidies are their own sources, never "production". */
export const SOURCE_KINDS = ['production', 'terraform', 'starter_grant', 'subsidy'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * `stock`: inventory is `col.stock`, so cargo export/import are flows (exports / imports).
 * `position`: inventory is stock + orbit + in-flight (`colonyPosition`), so cargo moves are internal and only market
 * `trade` crosses the boundary.
 */
export type FlowBasis = 'stock' | 'position';

/** One resource's flows in one scope over one window, whole units as bigint. */
export interface ResourceFlow {
  /** Credited production by source kind (what reached stock). */
  production: Record<SourceKind, bigint>;
  /** Output lost to the storage cap, by source kind. Reported apart: NOT in `production`, not in inventory. */
  capped: Record<SourceKind, bigint>;
  /** Gross consumption by activity (`construction`, `production_input`, `adjustment`). */
  consumption: Record<string, bigint>;
  /** Refunds and salvage returned (`construction.refund`, `building.sell`): netted off consumption. */
  recovered: bigint;
  imports: bigint;
  exports: bigint;
  /** Cargo moves that stay inside a position (`position` basis only). */
  cargoInternalIn: bigint;
  cargoInternalOut: bigint;
  /** Moves between colonies (no `sys:*` leg): they cancel at global scope. */
  transferIn: bigint;
  transferOut: bigint;
}

export const emptyFlow = (): ResourceFlow => ({
  production: { production: 0n, terraform: 0n, starter_grant: 0n, subsidy: 0n },
  capped: { production: 0n, terraform: 0n, starter_grant: 0n, subsidy: 0n },
  consumption: {},
  recovered: 0n,
  imports: 0n,
  exports: 0n,
  cargoInternalIn: 0n,
  cargoInternalOut: 0n,
  transferIn: 0n,
  transferOut: 0n,
});

const SOURCE_OF_REASON: Readonly<Record<string, SourceKind>> = {
  'production.tick': 'production',
  'terraform.yield': 'terraform',
  'landing.cargo': 'starter_grant',
  'dev.grant': 'subsidy',
  'admin.correction': 'subsidy',
};
const RECOVERED_REASONS: ReadonlySet<string> = new Set(['construction.refund', 'building.sell', 'transport.release', 'logistics.release']);
const ACTIVITY_OF_REASON: Readonly<Record<string, string>> = {
  'construction.spend': 'construction',
  'production.consume': 'production_input',
  'transport.reserve': 'transport',
  'logistics.supply': 'logistics',
  'logistics.activate': 'logistics',
  'dev.grant': 'adjustment',
  'admin.correction': 'adjustment',
};

export const sumValues = (rec: Readonly<Record<string, bigint>>): bigint => Object.values(rec).reduce((a, b) => a + b, 0n);
export const totalProduction = (f: ResourceFlow): bigint => sumValues(f.production);
export const totalCapped = (f: ResourceFlow): bigint => sumValues(f.capped);
export const grossConsumption = (f: ResourceFlow): bigint => sumValues(f.consumption);
/** `consumption_r` of ECONOMY §2 for a window: gross activity inputs minus recovered resources. */
export const netConsumption = (f: ResourceFlow): bigint => grossConsumption(f) - f.recovered;

function addTo(f: ResourceFlow, p: PostingInput, delta: bigint, basis: FlowBasis): void {
  const reason = p.reason;
  if (delta > 0n) {
    const src = SOURCE_OF_REASON[reason];
    if (src) f.production[src] += delta;
    else if (RECOVERED_REASONS.has(reason)) f.recovered += delta;
    else if (reason === 'trade') f.imports += delta;
    else if (reason === 'cargo.import' || reason === 'cargo.refund') {
      if (basis === 'stock') f.imports += delta;
      else f.cargoInternalIn += delta;
    }
    return;
  }
  const out = -delta;
  const activity = ACTIVITY_OF_REASON[reason];
  if (activity) f.consumption[activity] = (f.consumption[activity] ?? 0n) + out;
  else if (reason === 'trade') f.exports += out;
  else if (reason === 'cargo.export') {
    if (basis === 'stock') f.exports += out;
    else f.cargoInternalOut += out;
  }
}

export interface FlowReport {
  readonly window: FlowWindow;
  readonly basis: FlowBasis;
  /** Colony index -> resource -> flow. */
  readonly byColony: ReadonlyMap<number, Record<ResourceKey, ResourceFlow>>;
  /** All colonies summed once; `transferIn - transferOut` is 0 (transfers cancel). */
  readonly global: Record<ResourceKey, ResourceFlow>;
}

function flowTable(): Record<ResourceKey, ResourceFlow> {
  const out = {} as Record<ResourceKey, ResourceFlow>;
  for (const k of RESOURCE_KEYS) out[k] = emptyFlow();
  return out;
}

const isResource = (a: string): a is ResourceKey => (RESOURCE_KEYS as readonly string[]).includes(a);

/**
 * Splits the ledger postings of a window into per-colony and global flows (ECONOMY §2). The window is
 * `(startTick, endTick]`: a posting `at` tick T belongs to the step that produced T, and the opening inventory is the
 * state at `startTick`, so one boundary is used everywhere. `ledger.opening` postings are not flows and are skipped.
 * A posting whose asset has no `sys:*` leg is a transfer between colonies: it shows as `transferOut` / `transferIn`
 * in each colony and cancels in `global`. A `sys:overflow` leg is output lost to the cap (`capped`).
 */
export function accountFlows(postings: readonly PostingInput[], window: FlowWindow, basis: FlowBasis = 'position'): FlowReport {
  const byColony = new Map<number, Record<ResourceKey, ResourceFlow>>();
  const global = flowTable();
  const colonyFlow = (i: number): Record<ResourceKey, ResourceFlow> => {
    let t = byColony.get(i);
    if (!t) byColony.set(i, (t = flowTable()));
    return t;
  };
  for (const p of postings) {
    if (p.at <= window.startTick || p.at > window.endTick || p.reason === 'ledger.opening') continue;
    const assets = new Set(p.legs.map((l) => l.asset).filter(isResource));
    for (const asset of assets) {
      const legs = p.legs.filter((l) => l.asset === asset);
      const hasSystem = legs.some((l) => isSystemAccount(l.account));
      for (const l of legs) {
        const delta = BigInt(l.delta);
        if (isSystemAccount(l.account)) continue;
        const ci = colonyIndexOfAccount(l.account);
        if (ci < 0) continue;
        const flows = [colonyFlow(ci)[asset], global[asset]];
        for (const f of flows) {
          if (hasSystem) addTo(f, p, delta, basis);
          else if (delta > 0n) f.transferIn += delta;
          else f.transferOut += -delta;
        }
      }
      const src = SOURCE_OF_REASON[p.reason];
      const lost = legs.filter((l) => l.account === 'sys:overflow' && l.delta > 0).reduce((a, l) => a + BigInt(l.delta), 0n);
      if (src && lost > 0n) {
        global[asset].capped[src] += lost;
        // Attributed to the colony that was credited in the same entry; a fully capped entry has no colony leg, so it
        // shows in `global` only.
        const credited = legs.find((l) => colonyIndexOfAccount(l.account) >= 0);
        if (credited) colonyFlow(colonyIndexOfAccount(credited.account))[asset].capped[src] += lost;
      }
    }
  }
  return { window, basis, byColony, global };
}
