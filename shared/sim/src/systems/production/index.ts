import type { ResourceKey } from '@terra/contracts';
import { compileData, consumeDepositRichness, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, setField } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { creditResource, ensureColonyLedger, isFamilyAtCap } from '../economy/ledger';
import { depositFamilyAndKey } from '../harvest/adjacency';

export interface DepositCoverageResult {
  covered: boolean;
  richnessMult: number;
  depositTiles: number[];
  invalidTile: boolean;
}

export interface PlaceExtractorOptions {
  owner: number;
  q: number;
  r: number;
  rot?: number;
  completed?: boolean;
  tick?: number;
  data?: CompiledDataLike;
}

let cachedW02Data: CompiledDataLike | null = null;
function defaultW02Data(): CompiledDataLike {
  if (!cachedW02Data) cachedW02Data = compileData(new Set(['W00', 'W01', 'W02']));
  return cachedW02Data;
}

export function resolveExtractorRow(data?: CompiledDataLike): CompiledRow {
  const t = data?.tables?.economyT1Basic as Record<string, CompiledRow> | undefined;
  if (t?.metalsExtractor) return t.metalsExtractor;
  return dataRow(defaultW02Data(), 'economyT1Basic', 'metalsExtractor');
}

export function normalizeRichness(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // generateTemperate stores richness in basis points (e.g. 9000..13800 bp); tests may set float (e.g. 1.15)
  if (raw <= 10) return raw;
  // As finite deposits deplete from 10000 bp down toward 0, keep extraction rate at 1.0x until depleted
  return raw > 10000 ? raw / 10000 : 1.0;
}

/**
 * Checks whether a footprint `(w, d)` anchored at `(q, r)` covers at least one tile with `requiredDeposit`
 * (`DEPOSIT.metals` = 1) and computes the effective deposit richness multiplier (`0.9..1.38`, default `1.0`).
 */
export function checkExtractorDepositCoverage(
  state: PlanetState,
  q: number,
  r: number,
  w = 2,
  d = 2,
  rot = 0,
  requiredDeposit: number = DEPOSIT.metals,
): DepositCoverageResult {
  const swap = rot % 2 !== 0;
  const fw = Math.max(1, swap ? d : w);
  const fd = Math.max(1, swap ? w : d);
  const idx = hexIndex(state.grid.radius);
  const depositLayer = state.grid.layers.deposit as Uint8Array;
  const richnessLayer = state.grid.layers.richness as Float32Array | undefined;

  const depositTiles: number[] = [];
  let bestRichness = 0;

  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      const tileIdx = idx.indexOf(q + dq, r + dr);
      if (tileIdx < 0) {
        return { covered: false, richnessMult: 0, depositTiles: [], invalidTile: true };
      }
      const rawRich = richnessLayer ? Number(richnessLayer[tileIdx] ?? 0) : 10000;
      if (depositLayer[tileIdx] === requiredDeposit && rawRich > 0) {
        depositTiles.push(tileIdx);
        const rMult = normalizeRichness(rawRich);
        if (rMult > bestRichness) bestRichness = rMult;
      }
    }
  }

  return {
    covered: depositTiles.length > 0,
    richnessMult: depositTiles.length > 0 ? bestRichness : 0,
    depositTiles,
    invalidTile: false,
  };
}

/** Validates whether a Metals Extractor T1 can be placed at `(q, r)`. Returns `'site_blocked'` when off deposit. */
export function validateMetalsExtractorSite(
  state: PlanetState,
  q: number,
  r: number,
  rot = 0,
  data?: CompiledDataLike,
): { ok: true; richnessMult: number } | { ok: false; code: 'site_blocked' | 'invalid_args'; detail: string } {
  const row = resolveExtractorRow(data);
  const w = Number(row.footprintW ?? 2);
  const d = Number(row.footprintD ?? 2);
  const cov = checkExtractorDepositCoverage(state, q, r, w, d, rot, DEPOSIT.metals);
  if (cov.invalidTile) return { ok: false, code: 'invalid_args', detail: 'out of bounds' };
  if (!cov.covered) return { ok: false, code: 'site_blocked', detail: 'no deposit' };
  return { ok: true, richnessMult: cov.richnessMult };
}

function ensureColonyForOwner(state: PlanetState, owner: number, tick: number): ColonyState {
  let col = state.colonies[owner];
  if (!col) {
    col = {
      index: owner,
      id: `col-${owner}`,
      name: `Colony ${owner + 1}`,
      color: 0xff6b00,
      status: 'active',
      changedAt: tick,
    };
    state.colonies[owner] = col;
  }
  return ensureColonyLedger(col);
}

/**
 * Places a Metals Extractor T1 at `(opts.q, opts.r)` after verifying deposit coverage (`DEPOSIT.metals`).
 * Returns `{ ok: false, code: 'site_blocked', detail: 'no deposit' }` if the 2×2 footprint does not cover a metals deposit.
 */
export function placeMetalsExtractor(
  state: PlanetState,
  opts: PlaceExtractorOptions,
  ctx?: StepContext,
): { ok: true; entityId: number; richnessMult: number } | { ok: false; code: string; detail: string } {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const check = validateMetalsExtractorSite(state, opts.q, opts.r, opts.rot ?? 0, data);
  if (!check.ok) return check;

  const extRow = resolveExtractorRow(data);
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;

  cols.kind[row] = ENTITY_KIND.metalsExtractor;
  cols.owner[row] = opts.owner;
  cols.tier[row] = Number(extRow.tier ?? 1);
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, tick);
  cols.rot[row] = opts.rot ?? 0;
  cols.footprintW[row] = Number(extRow.footprintW ?? 2);
  cols.footprintD[row] = Number(extRow.footprintD ?? 2);
  cols.shedGroup[row] = Number(extRow.shedGroup ?? 3);
  cols.hp[row] = Math.fround(Number(extRow.hp ?? 500));
  cols.hpMax[row] = Math.fround(Number(extRow.hp ?? 500));
  cols.state[row] = opts.completed === false ? ENTITY_STATE.constructing : ENTITY_STATE.active;
  cols.progress[row] = opts.completed === false ? 0 : 1;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;

  ensureColonyForOwner(state, opts.owner, tick);
  return { ok: true, entityId: id, richnessMult: check.richnessMult };
}

/**
 * Extracts up to `desired` units from the covered deposit tiles (in order) and credits each tile's yield to the stock
 * key of its tier (`depositTier`: a t2 / t3 metals deposit found by terraforming pays `metals.t2` / `metals.t3`, like a
 * Harvester). Returns what was extracted per key.
 */
function extractTiered(state: PlanetState, colony: ColonyState, depositTiles: readonly number[], desired: number, tick: number): Map<ResourceKey, number> {
  const out = new Map<ResourceKey, number>();
  const tiers = state.grid.layers.depositTier as Uint8Array | undefined;
  let remaining = desired;
  for (const depTileIdx of depositTiles) {
    if (remaining <= 0) break;
    const got = consumeDepositRichness(state, depTileIdx, remaining, tick);
    if (got <= 0) continue;
    remaining -= got;
    const key = depositFamilyAndKey(DEPOSIT.metals, tiers?.[depTileIdx] ?? 0)!.key;
    creditResource(colony, key, got, tick);
    out.set(key, (out.get(key) ?? 0) + got);
  }
  return out;
}

const METALS_KEYS: readonly ResourceKey[] = ['metals.t1', 'metals.t2', 'metals.t3'];

const extractorProductionSystem = defineSystem({
  id: 'production.extractors',
  slot: 8,
  wave: 'W02',
  run(state, ctx) {
    const extRow = resolveExtractorRow(ctx.data);
    const baseOutputPerS = Number(extRow.outputPerS ?? 1.0); // 4.0 * ECONOMY_RATE_SCALE(0.25) = 1.0
    const e = state.entities;
    const cols = e.cols;

    const extractorIncomeByOwner = new Map<number, Partial<Record<ResourceKey, number>>>();

    for (let row = 0; row < e.count; row++) {
      if (cols.kind[row] !== ENTITY_KIND.metalsExtractor) continue;
      if (cols.hp[row] <= 0) continue;

      const st = cols.state[row];
      if (
        st === ENTITY_STATE.constructing ||
        st === ENTITY_STATE.offlineBrownout ||
        st === ENTITY_STATE.offlineUnpowered
      ) {
        continue;
      }

      const owner = cols.owner[row];
      const colony = ensureColonyForOwner(state, owner, ctx.tick);

      if (isFamilyAtCap(colony, 'metals')) {
        if (st !== ENTITY_STATE.offlineCapped) {
          setField(e, row, 'state', ENTITY_STATE.offlineCapped, ctx.tick);
        }
        continue;
      }

      if (st === ENTITY_STATE.offlineCapped) {
        setField(e, row, 'state', ENTITY_STATE.active, ctx.tick);
      }

      const w = cols.footprintW?.[row] || Number(extRow.footprintW ?? 2);
      const d = cols.footprintD?.[row] || Number(extRow.footprintD ?? 2);
      const cov = checkExtractorDepositCoverage(state, cols.q[row], cols.r[row], w, d, cols.rot[row], DEPOSIT.metals);
      if (!cov.covered) continue;

      const ratePerS = baseOutputPerS * cov.richnessMult;
      const desiredAmount = (ratePerS * TICK_MS * ctx.dt) / 1000;
      const byKey = extractTiered(state, colony, cov.depositTiles, desiredAmount, ctx.tick);
      let extracted = 0;
      for (const v of byKey.values()) extracted += v;
      if (extracted <= 0) continue;
      const income = extractorIncomeByOwner.get(owner) ?? {};
      for (const [key, got] of byKey) income[key] = (income[key] ?? 0) + (ratePerS * got) / extracted;
      extractorIncomeByOwner.set(owner, income);

      if (isFamilyAtCap(colony, 'metals')) {
        setField(e, row, 'state', ENTITY_STATE.offlineCapped, ctx.tick);
      }
    }

    for (const colony of state.colonies) {
      if (!colony) continue;
      const c = ensureColonyLedger(colony);
      const income = extractorIncomeByOwner.get(c.index) ?? {};
      let family = 0;
      for (const key of METALS_KEYS) {
        c.production.incomePerS[key] = Number((income[key] ?? 0).toFixed(4)); // the metals rates' reset: harvest adds after
        family += income[key] ?? 0;
      }
      c.production.familyIncomePerS.metals = Number(family.toFixed(4));
    }
  },
});

export default defineSimModule({
  id: 'production',
  wave: 'W02',
  systems: [extractorProductionSystem],
});
