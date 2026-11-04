import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { ensureColonyLedger } from './ledger';

/** Building rows, footprints and the colony ledger as the W02 build path (`economy.construction`, the queue) sees them. */

let cachedData: CompiledDataLike | null = null;
function defaultData(): CompiledDataLike {
  if (!cachedData) cachedData = compileData(new Set(['W00', 'W01', 'W02', 'W10']));
  return cachedData;
}

export function resolveBuildingRow(building: string, data?: CompiledDataLike): { row: CompiledRow; entityKind: number } | null {
  const d = data?.tables?.economyT1Basic ? data : defaultData();
  if (building === 'commandHub' || building === 'hub' || building === 't1') {
    return { row: dataRow(d, 'hub', 't1'), entityKind: ENTITY_KIND.commandHub };
  }
  if (building === 'metalsExtractor' || building === 'extractor') {
    return { row: dataRow(d, 'economyT1Basic', 'metalsExtractor'), entityKind: ENTITY_KIND.metalsExtractor };
  }
  if (building === 'solar' || building === 'solarCollector') {
    return { row: dataRow(d, 'economyT1Basic', 'solar'), entityKind: ENTITY_KIND.solar };
  }
  if (building === 'tradeHub' || building === 'interColonyTradeHub') {
    const tradeHubTable = data?.tables?.tradeHub as Record<string, CompiledRow> | undefined;
    if (data?.tables && !tradeHubTable?.t1) return null;
    const src = (d.tables?.tradeHub as Record<string, CompiledRow> | undefined)?.t1 ? d : defaultData();
    return { row: dataRow(src, 'tradeHub', 't1'), entityKind: ENTITY_KIND.tradeHub };
  }
  return null;
}

export function buildingKindName(entityKind: number): string {
  if (entityKind === ENTITY_KIND.commandHub) return 'commandHub';
  if (entityKind === ENTITY_KIND.metalsExtractor) return 'metalsExtractor';
  if (entityKind === ENTITY_KIND.solar) return 'solar';
  if (entityKind === ENTITY_KIND.tradeHub) return 'tradeHub';
  return 'building';
}

export function getFootprintTileIndices(
  state: PlanetState,
  q: number,
  r: number,
  w: number,
  d: number,
  rot = 0,
): { valid: boolean; indices: number[]; coords: Array<{ q: number; r: number }> } {
  const swap = rot % 2 !== 0;
  const fw = Math.max(1, swap ? d : w);
  const fd = Math.max(1, swap ? w : d);
  const minQ = -Math.floor((fw - 1) / 2);
  const minR = -Math.floor((fd - 1) / 2);
  const idx = hexIndex(state.grid.radius);
  const indices: number[] = [];
  const coords: Array<{ q: number; r: number }> = [];

  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      const tq = q + minQ + dq;
      const tr = r + minR + dr;
      const tileIdx = idx.indexOf(tq, tr);
      if (tileIdx < 0) return { valid: false, indices: [], coords: [] };
      indices.push(tileIdx);
      coords.push({ q: tq, r: tr });
    }
  }
  return { valid: true, indices, coords };
}

/** The colony record of `owner` with its ledger (created when missing). */
export function ensureColony(state: PlanetState, owner: number, tick: number): ColonyState {
  let col = state.colonies[owner];
  if (!col) {
    col = { index: owner, id: `col-${owner}`, name: `Colony ${owner + 1}`, color: 0xff6b00, status: 'active', changedAt: tick };
    state.colonies[owner] = col;
  }
  return ensureColonyLedger(col);
}
