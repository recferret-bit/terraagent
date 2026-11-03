import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createRegistryPipeline,
  createState,
  dataRow,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyPower,
  indexOf,
  insertRow,
  placeMetalsExtractor,
  rowOf,
  setHqCellEnergy,
  setPlanetTime,
  spawnHqUnit,
  step,
  type PlanetState,
} from '../../src';

/**
 * The owner's reports "I built an iron extractor and energy is still 200/200" (W02) and "all works by day, all dies at
 * night" (W03): the Command Hub's grid draws the HQ power cell (the top-bar `n / max E` chip) when demand is over
 * generation, and only sheds (group 3 first) once the cell is empty. The cell no longer recharges for free next to the
 * Hub: grid surplus refills it (`power-core/hqCell.ts`). Numbers come from the rows, so a retune keeps this spec.
 */
const DATA = compileData(parseWaves('..02'));
const num = (table: string, id: string, field: string): number => Number(dataRow(DATA, table, id)[field]);
const FOUNDER = num('hub', 't1', 'founderCoreGenPerS');
const HUB_DRAIN = num('hub', 't1', 'powerDrainPerS');
const EXT_DRAIN = num('economyT1Basic', 'metalsExtractor', 'powerDrainPerS');
/** Just enough Extractors to put the Hub's grid in deficit (2 with the W03 retune: 7 + 2 × 8 > 16). */
const EXTRACTORS = Math.floor((FOUNDER - HUB_DRAIN) / EXT_DRAIN) + 1;
const DEMAND = HUB_DRAIN + EXTRACTORS * EXT_DRAIN;
const DEFICIT = DEMAND - FOUNDER;
const SITES: ReadonlyArray<readonly [number, number]> = [[3, 0], [-5, 0], [0, 4], [0, -5]];

function colonyWithHubHqAndExtractor(): { state: PlanetState; hqRow: number; extRow: number; extId: number } {
  const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02-ext', radius: 10 });
  const cols = state.entities.cols;
  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  cols.kind[hubRow] = ENTITY_KIND.commandHub;
  cols.owner[hubRow] = 0;
  cols.footprintW[hubRow] = 3;
  cols.footprintD[hubRow] = 3;
  cols.hp[hubRow] = 1500;
  cols.hpMax[hubRow] = 1500;
  cols.state[hubRow] = ENTITY_STATE.active;
  const hqId = spawnHqUnit(state, { owner: 0, q: 2, r: -1 });
  let extId = -1;
  for (const [q, r] of SITES.slice(0, EXTRACTORS)) {
    for (const [dq, dr] of [[0, 0], [1, 0]] as const) {
      const i = indexOf(state.grid.radius, q + dq, r + dr);
      state.grid.layers.deposit[i] = DEPOSIT.metals;
      state.grid.layers.richness[i] = 10000;
    }
    const placed = placeMetalsExtractor(state, { owner: 0, q, r });
    if (!placed.ok) throw new Error(`extractor not placed: ${placed.code}`);
    extId = placed.entityId; // the newest: the first one shed
  }
  return { state, hqRow: rowOf(state.entities, hqId), extRow: rowOf(state.entities, extId), extId };
}

const metals = (state: PlanetState): number => Number((state.colonies[0]?.stock as Record<string, number> | undefined)?.['metals.t1'] ?? 0);

describe('Hub + HQ + Metals Extractors over its headroom: the HQ cell carries the deficit, shedding starts when it is empty', () => {
  it('a Hub-only grid over its headroom runs from the HQ cell: no brownout, the cell drains at the deficit', () => {
    expect(DEFICIT).toBeGreaterThan(0); // the balance this spec is about: the Extractors are more than the Hub's headroom
    const { state, hqRow, extRow } = colonyWithHubHqAndExtractor();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const cellMax = state.entities.cols.cellMax[hqRow];
    const before = metals(state);

    for (let i = 0; i < 50; i++) step(state, [], 1, pipeline); // 10 s

    const power = getColonyPower(state, 0);
    expect(power.generationPerS).toBe(FOUNDER);
    expect(power.rawDemand).toBe(DEMAND);
    expect(power.hqCellLinked).toBe(true);
    expect(power.hqCellDischargePerS).toBeCloseTo(DEFICIT, 3);
    expect(power.supply).toBeCloseTo(DEMAND, 3); // generation + cell discharge
    expect(power.brownout).toBe(false);
    expect(power.shedEntityIds).toEqual([]);
    expect(state.entities.cols.state[extRow]).toBe(ENTITY_STATE.active);
    expect(metals(state)).toBeGreaterThan(before);
    // The chip's number: the HQ cell lost the deficit for 10 s and was not topped up for free
    expect(state.entities.cols.cell[hqRow]).toBeCloseTo(cellMax - DEFICIT * 10, 1);
    const blob = (state.blobs.power?.value as { byColony: Record<number, unknown> }).byColony[0];
    expect(blob).toEqual(power);
  });

  it('with an empty cell the newest Extractor is shed (group 3), the cell stays empty, and grid surplus refills it', () => {
    const { state, hqRow, extRow, extId } = colonyWithHubHqAndExtractor();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    const cols = state.entities.cols;
    setPlanetTime(state, { timeOfDay: 0 }, state.meta.tick); // midnight: no solar
    setHqCellEnergy(state, hqRow, 0);

    for (let i = 0; i < 5; i++) step(state, [], 1, pipeline);
    let power = getColonyPower(state, 0);
    expect(power.brownout).toBe(true);
    expect(power.shedEntityIds).toEqual([extId]);
    expect(power.shedGroupsActive).toEqual([3]);
    expect(power.offlineReasons[extId]).toBe('offline: brownout');
    expect(cols.state[extRow]).toBe(ENTITY_STATE.offlineBrownout);
    expect(cols.cell[hqRow]).toBe(0); // no free recharge while the grid owns the cell

    // A midday Solar carries the Extractor; the rest of its output refills the cell (HQ docked: up to the fast rate)
    setPlanetTime(state, { timeOfDay: 12 }, state.meta.tick);
    const solarRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    cols.kind[solarRow] = ENTITY_KIND.solar;
    cols.owner[solarRow] = 0;
    cols.q[solarRow] = -3;
    cols.r[solarRow] = 0;
    cols.footprintW[solarRow] = 2;
    cols.footprintD[solarRow] = 2;
    cols.hp[solarRow] = 400;
    cols.state[solarRow] = ENTITY_STATE.active;
    step(state, [], 1, pipeline);
    power = getColonyPower(state, 0);
    expect(power.brownout).toBe(false);
    expect(cols.state[extRow]).toBe(ENTITY_STATE.active);
    const surplus = (power.generationPerS ?? 0) - power.rawDemand;
    expect(surplus).toBeGreaterThan(0);
    expect(power.hqCellChargePerS).toBeGreaterThan(0);
    expect(power.hqCellChargePerS).toBeLessThanOrEqual(surplus + 1e-6);
    expect(cols.cell[hqRow]).toBeCloseTo((power.hqCellChargePerS ?? 0) * 0.2, 3);
    const metalsBefore = metals(state);
    step(state, [], 5, pipeline);
    expect(metals(state)).toBeGreaterThan(metalsBefore); // a powered extractor produces
  });
});
