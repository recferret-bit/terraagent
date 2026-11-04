import { describe, expect, it } from 'vitest';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  getDayLengthTicks,
  placeMetalsExtractor,
  placeMineralsQuarry,
  rowOf,
  setHqCellEnergy,
  type ColonyPowerSummary,
} from '@terra/sim';
import { createScenarioPlanet } from '../_loader';

/**
 * Owner feedback (W03): "all works by day, all dies at night; it must just spend the energy". The W03 start colony
 * (Command Hub, 1 Metals Extractor, 1 Solar, HQ + 2 Harvesters) runs a surplus by day, a deficit at night that the HQ
 * cell (the top-bar chip) carries, and sheds by groups only once the cell is empty (`power-core/hqCell.ts`).
 */
type Host = ReturnType<typeof createScenarioPlanet>['host'];

function w03(): { host: Host; power: () => ColonyPowerSummary; hqRow: number; cell: () => number } {
  const { host } = createScenarioPlanet('w03');
  const cols = host.state.entities.cols;
  let hqRow = -1;
  for (let r = 0; r < host.state.entities.count; r++) if (cols.kind[r] === ENTITY_KIND.hq) hqRow = r;
  const power = () => host.state.colonies[0]!.power as unknown as ColonyPowerSummary;
  return { host, power, hqRow, cell: () => host.state.entities.cols.cell[hqRow] };
}

function extractorRow(host: Host): number {
  const cols = host.state.entities.cols;
  for (let r = 0; r < host.state.entities.count; r++) if (cols.kind[r] === ENTITY_KIND.metalsExtractor) return r;
  return -1;
}

/** Steps to the next nightfall (the first step whose power summary reads `night`). */
function stepToNight(host: Host, power: () => ColonyPowerSummary): void {
  for (let n = 0; n < getDayLengthTicks() && power().phase !== 'night'; n++) host.step(1);
  expect(power().phase).toBe('night');
}

describe('W03 start colony across a full day / night cycle (HQ cell as the grid store)', () => {
  it('runs a surplus by day, drains the HQ cell at night without shedding anything, and recharges it the next day', { timeout: 30_000 }, () => {
    const { host, power, cell, hqRow } = w03();
    const cellMax = host.state.entities.cols.cellMax[hqRow];
    host.step(1);
    expect(power().phase).toBe('day');
    expect((power().generationPerS ?? 0) - power().rawDemand).toBeGreaterThan(0); // small positive day net

    let nightMin = Infinity, nightTicks = 0, sheds = 0;
    const dayTicks = getDayLengthTicks();
    for (let t = 0; t < dayTicks; t++) {
      host.step(1);
      const p = power();
      if (p.shedEntityIds.length > 0 || p.brownout) sheds++;
      if (p.phase !== 'night') continue;
      nightTicks++;
      nightMin = Math.min(nightMin, cell());
      // At night the cell covers exactly the deficit (generation is the Founder Core alone)
      expect(p.hqCellDischargePerS ?? 0).toBeCloseTo(Math.max(0, p.rawDemand - (p.generationPerS ?? 0)), 3);
    }
    expect(nightTicks).toBeGreaterThan(1000); // one whole night was stepped
    expect(sheds).toBe(0); // no brownout, day or night
    expect(nightMin).toBeLessThan(cellMax - 100); // the chip visibly drained
    expect(nightMin).toBeGreaterThan(0);
    expect(power().phase).toBe('day');
    expect(cell()).toBeGreaterThan(nightMin); // the morning surplus refills it
  });

  it('a night with too little stored energy sheds group 3 only once the HQ cell is empty; by day only the newest consumer stays shed', { timeout: 30_000 }, () => {
    const { host, power, cell, hqRow } = w03();
    const ext = extractorRow(host);
    // Two more consumers without another generator: a second Metals Extractor and a Minerals Quarry
    const ext2 = placeMetalsExtractor(host.state, { owner: 0, q: 6, r: 0 });
    const quarry = placeMineralsQuarry(host.state, { owner: 0, q: 0, r: 3 });
    expect(ext2.ok && quarry.ok).toBe(true);
    host.step(1);
    // ...turn the day net negative: the cell drains by day too (the player needs a generator or a Capacitor Bank)
    expect((power().generationPerS ?? 0) - power().rawDemand).toBeLessThan(0);
    expect(power().brownout).toBe(false);

    stepToNight(host, power);
    setHqCellEnergy(host.state, hqRow, 60);
    let firstShedTick = -1, cellBefore = -1;
    for (let t = 0; t < 400 && firstShedTick < 0; t++) {
      cellBefore = cell();
      host.step(1);
      if (power().shedEntityIds.length > 0) firstShedTick = t;
      else expect(power().brownout).toBe(false);
    }
    expect(firstShedTick).toBeGreaterThan(0);
    expect(cell()).toBe(0);
    expect(cellBefore).toBeLessThan(power().rawDemand * 0.2); // the cell ran dry on this very step
    expect(power().shedGroupsActive).toEqual([3]); // extractors / quarry: the Hub and units keep running
    const newest = ext2.ok && quarry.ok ? Math.max(ext2.entityId, quarry.entityId) : -1;
    expect(power().shedEntityIds[0]).toBe(newest);

    // Morning: the Solar returns, but with an empty cell the day deficit still sheds the newest consumer only;
    // the older Extractors run again
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'w03-day', kind: 'dev.time', args: { target: 'day' } });
    host.step(2);
    expect(power().phase).toBe('day');
    expect(power().shedEntityIds).toEqual([newest]);
    expect(host.state.entities.cols.state[rowOf(host.state.entities, newest)]).toBe(ENTITY_STATE.offlineBrownout);
    expect(host.state.entities.cols.state[ext]).not.toBe(ENTITY_STATE.offlineBrownout); // running (or capped by storage)
  });
});
