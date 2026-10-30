import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
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

function normalizeRichness(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1.0;
  // generateTemperate stores richness in basis points (e.g. 9000..13800 bp); tests may set float (e.g. 1.15)
  return raw > 10 ? raw / 10000 : raw;
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
      if (depositLayer[tileIdx] === requiredDeposit) {
        depositTiles.push(tileIdx);
        const rMult = normalizeRichness(richnessLayer?.[tileIdx] ?? 0);
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
  cols.q[row] = opts.q;
  cols.r[row] = opts.r;
  cols.x[row] = Math.fround(opts.q);
  cols.y[row] = Math.fround(opts.r);
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

const extractorProductionSystem = defineSystem({
  id: 'production.extractors',
  slot: 8,
  wave: 'W02',
  run(state, ctx) {
    const extRow = resolveExtractorRow(ctx.data);
    const baseOutputPerS = Number(extRow.outputPerS ?? 1.0); // 4.0 * ECONOMY_RATE_SCALE(0.25) = 1.0
    const e = state.entities;
    const cols = e.cols;

    const extractorIncomeByOwner = new Map<number, number>();

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
      const amount = (ratePerS * TICK_MS * ctx.dt) / 1000;
      creditResource(colony, 'metals.t1', amount, ctx.tick);

      extractorIncomeByOwner.set(owner, (extractorIncomeByOwner.get(owner) ?? 0) + ratePerS);

      if (isFamilyAtCap(colony, 'metals')) {
        setField(e, row, 'state', ENTITY_STATE.offlineCapped, ctx.tick);
      }
    }

    for (const colony of state.colonies) {
      if (!colony) continue;
      const c = ensureColonyLedger(colony);
      const extRate = Number((extractorIncomeByOwner.get(c.index) ?? 0).toFixed(4));
      c.production.incomePerS['metals.t1'] = extRate;
      c.production.familyIncomePerS.metals = extRate;
    }
  },
});

export default defineSimModule({
  id: 'production',
  wave: 'W02',
  systems: [extractorProductionSystem],
});
