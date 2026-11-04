import type { ResourceFamily, ResourceKey } from '@terra/contracts';
import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { evaluatePlacement } from '../construction/placement';
import { placementWorldFromState } from '../construction/placementWorld';
import { ensureColonyLedger, syncColonyDepotCaps } from '../economy/ledger';

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

let cachedDefaultData: CompiledDataLike | null = null;
function defaultProductionData(): CompiledDataLike {
  if (!cachedDefaultData) cachedDefaultData = compileData(new Set(['W00', 'W01', 'W02', 'W03']));
  return cachedDefaultData;
}

export function resolveExtractorRow(data?: CompiledDataLike): CompiledRow {
  const t = data?.tables?.economyT1Basic as Record<string, CompiledRow> | undefined;
  if (t?.metalsExtractor) return t.metalsExtractor;
  return dataRow(defaultProductionData(), 'economyT1Basic', 'metalsExtractor');
}

export function resolveMineralsQuarryRow(data?: CompiledDataLike): CompiledRow {
  const t = data?.tables?.grid as Record<string, CompiledRow> | undefined;
  if (t?.mineralsQuarry) return t.mineralsQuarry;
  return dataRow(defaultProductionData(), 'grid', 'mineralsQuarry');
}

export function resolveWaterExtractorRow(data?: CompiledDataLike): CompiledRow {
  const t = data?.tables?.grid as Record<string, CompiledRow> | undefined;
  if (t?.waterExtractor) return t.waterExtractor;
  return dataRow(defaultProductionData(), 'grid', 'waterExtractor');
}

export function resolveSupplyDepotRow(data?: CompiledDataLike): CompiledRow {
  const t = data?.tables?.grid as Record<string, CompiledRow> | undefined;
  if (t?.supplyDepot) return t.supplyDepot;
  return dataRow(defaultProductionData(), 'grid', 'supplyDepot');
}

export function resolvePetroleumWellRow(data?: CompiledDataLike): CompiledRow {
  const t = data?.tables?.grid as Record<string, CompiledRow> | undefined;
  if (t?.petroleumWell) return t.petroleumWell;
  return dataRow(defaultProductionData(), 'grid', 'petroleumWell');
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
 * (`DEPOSIT.metals` = 1, `DEPOSIT.minerals` = 2, `DEPOSIT.oil` = 3) and computes the effective deposit richness multiplier.
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

export function ensureColonyForOwner(state: PlanetState, owner: number, tick: number): ColonyState {
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

function spawnPlacedBuildingEntity(
  state: PlanetState,
  entityKind: number,
  rowDef: CompiledRow,
  opts: PlaceExtractorOptions,
  tick: number,
  ctx?: StepContext,
): number {
  const id = ctx ? ctx.newEntityId() : state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;

  cols.kind[row] = entityKind;
  cols.owner[row] = opts.owner;
  cols.tier[row] = Number(rowDef.tier ?? 1);
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, tick);
  cols.rot[row] = opts.rot ?? 0;
  cols.footprintW[row] = Number(rowDef.footprintW ?? 2);
  cols.footprintD[row] = Number(rowDef.footprintD ?? 2);
  cols.shedGroup[row] = Number(rowDef.shedGroup ?? 3);
  cols.hp[row] = Math.fround(Number(rowDef.hp ?? 500));
  cols.hpMax[row] = Math.fround(Number(rowDef.hp ?? 500));
  cols.state[row] = opts.completed === false ? ENTITY_STATE.constructing : ENTITY_STATE.active;
  cols.progress[row] = opts.completed === false ? 0 : 1;
  cols.createdAt[row] = tick;
  cols.changedAt[row] = tick;
  return id;
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
  const metal = checkExtractorDepositCoverage(state, q, r, w, d, rot, DEPOSIT.metals);
  const cov = metal.covered ? metal : checkExtractorDepositCoverage(state, q, r, w, d, rot, DEPOSIT.minerals);
  if (cov.invalidTile) return { ok: false, code: 'invalid_args', detail: 'out of bounds' };
  if (!cov.covered) return { ok: false, code: 'site_blocked', detail: 'no deposit' };
  return { ok: true, richnessMult: cov.richnessMult };
}

/** Validates whether a Minerals Quarry T1 can be placed at `(q, r)`. Returns `'site_blocked'` when off a minerals deposit. */
export function validateMineralsQuarrySite(
  state: PlanetState,
  q: number,
  r: number,
  rot = 0,
  data?: CompiledDataLike,
): { ok: true; richnessMult: number } | { ok: false; code: 'site_blocked' | 'invalid_args'; detail: string } {
  const row = resolveMineralsQuarryRow(data);
  const w = Number(row.footprintW ?? 2);
  const d = Number(row.footprintD ?? 2);
  const cov = checkExtractorDepositCoverage(state, q, r, w, d, rot, DEPOSIT.minerals);
  if (cov.invalidTile) return { ok: false, code: 'invalid_args', detail: 'out of bounds' };
  if (!cov.covered) return { ok: false, code: 'site_blocked', detail: 'no deposit' };
  return { ok: true, richnessMult: cov.richnessMult };
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
  const id = spawnPlacedBuildingEntity(state, ENTITY_KIND.metalsExtractor, extRow, opts, tick, ctx);
  ensureColonyForOwner(state, opts.owner, tick);
  return { ok: true, entityId: id, richnessMult: check.richnessMult };
}

/**
 * Places a Minerals Quarry T1 at `(opts.q, opts.r)` after verifying deposit coverage (`DEPOSIT.minerals`) and D-37 placement.
 * Returns `{ ok: false, code: 'site_blocked', detail: 'no deposit' }` if the 2×2 footprint does not cover a minerals deposit.
 */
export function placeMineralsQuarry(
  state: PlanetState,
  opts: PlaceExtractorOptions,
  ctx?: StepContext,
): { ok: true; entityId: number; richnessMult: number } | { ok: false; code: string; detail: string } {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const check = validateMineralsQuarrySite(state, opts.q, opts.r, opts.rot ?? 0, data);
  if (!check.ok) return check;
  const evalRes = evaluatePlacement(placementWorldFromState(state), {
    colonyId: opts.owner,
    building: 'mineralsQuarry',
    q: opts.q,
    r: opts.r,
    requireBuilder: false,
    data,
  });
  if (!evalRes.ok) {
    return {
      ok: false,
      code: evalRes.code ?? 'site_blocked',
      detail: evalRes.block === 'noDeposit' ? 'no deposit' : (evalRes.text ?? 'site blocked'),
    };
  }

  const quarryRow = resolveMineralsQuarryRow(data);
  const id = spawnPlacedBuildingEntity(state, ENTITY_KIND.mineralsQuarry, quarryRow, opts, tick, ctx);
  ensureColonyForOwner(state, opts.owner, tick);
  return { ok: true, entityId: id, richnessMult: check.richnessMult };
}

/**
 * Places a Water Extractor T1 at `(opts.q, opts.r)` after verifying D-37 `evaluatePlacement`.
 * Does not require a resource deposit; outputs `bio.water` (`0.5×` on `desert`).
 */
export function placeWaterExtractor(
  state: PlanetState,
  opts: PlaceExtractorOptions,
  ctx?: StepContext,
): { ok: true; entityId: number; outputMult: number } | { ok: false; code: string; detail: string } {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const evalRes = evaluatePlacement(placementWorldFromState(state), {
    colonyId: opts.owner,
    building: 'waterExtractor',
    q: opts.q,
    r: opts.r,
    requireBuilder: false,
    data,
  });
  if (!evalRes.ok) {
    return { ok: false, code: evalRes.code ?? 'site_blocked', detail: evalRes.text ?? 'site blocked' };
  }

  const waterRow = resolveWaterExtractorRow(data);
  const id = spawnPlacedBuildingEntity(state, ENTITY_KIND.waterExtractor, waterRow, opts, tick, ctx);
  ensureColonyForOwner(state, opts.owner, tick);
  const outputMult = state.meta.planetType === 'desert' ? Number(waterRow.desertOutputMult ?? 0.5) : 1.0;
  return { ok: true, entityId: id, outputMult };
}

/**
 * Places a Supply Depot T1 at `(opts.q, opts.r)` after verifying D-37 `evaluatePlacement` and updates colony family caps (`+1000` each).
 */
export function placeSupplyDepot(
  state: PlanetState,
  opts: PlaceExtractorOptions,
  ctx?: StepContext,
): { ok: true; entityId: number; caps: Record<ResourceFamily, number> } | { ok: false; code: string; detail: string } {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? ctx?.data;
  const evalRes = evaluatePlacement(placementWorldFromState(state), {
    colonyId: opts.owner,
    building: 'supplyDepot',
    q: opts.q,
    r: opts.r,
    requireBuilder: false,
    data,
  });
  if (!evalRes.ok) {
    return { ok: false, code: evalRes.code ?? 'site_blocked', detail: evalRes.text ?? 'site blocked' };
  }

  const depotRow = resolveSupplyDepotRow(data);
  const id = spawnPlacedBuildingEntity(state, ENTITY_KIND.supplyDepot, depotRow, opts, tick, ctx);
  ensureColonyForOwner(state, opts.owner, tick);
  const caps = syncColonyDepotCaps(state, opts.owner, tick);
  return { ok: true, entityId: id, caps };
}

export type IncomeMapByOwner = Map<number, Partial<Record<ResourceKey, number>>>;
