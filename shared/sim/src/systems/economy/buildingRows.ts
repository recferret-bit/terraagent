import { compileData, dataRow, type CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { hexIndex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { ensureColonyLedger } from './ledger';

/** Building rows, footprints and the colony ledger as the W02 build path (`economy.construction`, the queue) sees them. */

let cachedData: CompiledDataLike | null = null;
function defaultData(): CompiledDataLike {
  if (!cachedData) cachedData = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W10']));
  return cachedData;
}

export function resolveBuildingRow(building: string, data?: CompiledDataLike): { row: CompiledRow; entityKind: number } | null {
  const d = data?.tables?.economyT1Basic ? data : defaultData();
  if (building === 'commandHub' || building === 'hub' || building === 't1') {
    const row = (d.tables.hub as Record<string, CompiledRow> | undefined)?.t1 ?? dataRow(defaultData(), 'hub', 't1');
    return { row, entityKind: ENTITY_KIND.commandHub };
  }
  const eco = d.tables.economyT1Basic as Record<string, CompiledRow> | undefined;
  if (building === 'metalsExtractor' || building === 'extractor') {
    return eco?.metalsExtractor ? { row: eco.metalsExtractor, entityKind: ENTITY_KIND.metalsExtractor } : null;
  }
  if (building === 'solar' || building === 'solarCollector') {
    return eco?.solar ? { row: eco.solar, entityKind: ENTITY_KIND.solar } : null;
  }
  const gridSrc = data?.tables?.grid ? data : defaultData();
  const grid = gridSrc.tables.grid as Record<string, CompiledRow> | undefined;
  if (building === 'pylon') {
    return grid?.pylon ? { row: grid.pylon, entityKind: ENTITY_KIND.pylon } : null;
  }
  if (building === 'capacitor') {
    return grid?.capacitor ? { row: grid.capacitor, entityKind: ENTITY_KIND.capacitor } : null;
  }
  if (building === 'wind') {
    return grid?.wind ? { row: grid.wind, entityKind: ENTITY_KIND.wind } : null;
  }
  if (building === 'thermal' || building === 'coalGen' || building === 'thermalPlant') {
    return grid?.thermal ? { row: grid.thermal, entityKind: ENTITY_KIND.thermal } : null;
  }
  if (building === 'supplyDepot' || building === 'depot') {
    return grid?.supplyDepot ? { row: grid.supplyDepot, entityKind: ENTITY_KIND.supplyDepot } : null;
  }
  if (building === 'mineralsQuarry' || building === 'quarry') {
    return grid?.mineralsQuarry ? { row: grid.mineralsQuarry, entityKind: ENTITY_KIND.mineralsQuarry } : null;
  }
  if (building === 'waterExtractor' || building === 'waterPump' || building === 'water') {
    return grid?.waterExtractor ? { row: grid.waterExtractor, entityKind: ENTITY_KIND.waterExtractor } : null;
  }
  if (building === 'petroleumWell' || building === 'oilWell') {
    return grid?.petroleumWell ? { row: grid.petroleumWell, entityKind: ENTITY_KIND.petroleumWell } : null;
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
  if (entityKind === ENTITY_KIND.pylon) return 'pylon';
  if (entityKind === ENTITY_KIND.capacitor) return 'capacitor';
  if (entityKind === ENTITY_KIND.wind) return 'wind';
  if (entityKind === ENTITY_KIND.thermal) return 'thermal';
  if (entityKind === ENTITY_KIND.supplyDepot) return 'supplyDepot';
  if (entityKind === ENTITY_KIND.mineralsQuarry) return 'mineralsQuarry';
  if (entityKind === ENTITY_KIND.waterExtractor) return 'waterExtractor';
  if (entityKind === ENTITY_KIND.petroleumWell) return 'petroleumWell';
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
