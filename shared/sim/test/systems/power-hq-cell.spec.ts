import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createState,
  ENTITY_KIND,
  ENTITY_STATE,
  hqCellGridLinked,
  insertRow,
  rowOf,
  setHqCellEnergy,
  spawnHqUnit,
  stepHq,
  stepHqCellForComponent,
  type PlanetState,
} from '../../src';

/** The HQ cell as the Hub grid's first store (`power-core/hqCell.ts`): charge / discharge caps and the link rule. */
const W02 = compileData(parseWaves('..02'));
const W01 = compileData(parseWaves('..01'));
const HUB = [{ q: 0, r: 0 }];

function colony(hqAt: { q: number; r: number }, hubState: number = ENTITY_STATE.active): { state: PlanetState; hq: number } {
  const state = createState({ planetId: 'p-cell', planetType: 'temperate', seed: 'hq-cell', radius: 16 });
  const cols = state.entities.cols;
  const hub = insertRow(state.entities, state.meta.nextEntityId++, 0);
  cols.kind[hub] = ENTITY_KIND.commandHub;
  cols.owner[hub] = 0;
  cols.hp[hub] = 1500;
  cols.hpMax[hub] = 1500;
  cols.state[hub] = hubState;
  const hq = rowOf(state.entities, spawnHqUnit(state, { owner: 0, ...hqAt }));
  return { state, hq };
}

describe('HQ cell on the Hub grid', () => {
  it('charges from surplus up to the fast rate while docked (within 6 tiles of the Hub), the self rate away', () => {
    const docked = colony({ q: 2, r: 0 });
    setHqCellEnergy(docked.state, docked.hq, 100);
    const d = stepHqCellForComponent(docked.state, 0, true, HUB, 40, 10, 1, 1, W02); // 30 E/s surplus
    expect(d).toMatchObject({ linked: true, chargePerS: 20, dischargePerS: 0 });
    expect(docked.state.entities.cols.cell[docked.hq]).toBeCloseTo(104, 4);

    const away = colony({ q: 9, r: 0 });
    setHqCellEnergy(away.state, away.hq, 100);
    expect(stepHqCellForComponent(away.state, 0, true, HUB, 40, 10, 1, 1, W02).chargePerS).toBe(3);
    // a small surplus is all it gets
    expect(stepHqCellForComponent(away.state, 0, true, HUB, 11, 10, 1, 2, W02).chargePerS).toBeCloseTo(1, 4);
  });

  it('discharges a deficit up to cellGridDischargePerS wherever the HQ is, never below 0; read-only with dtTicks 0', () => {
    const { state, hq } = colony({ q: 12, r: 0 });
    setHqCellEnergy(state, hq, 100);
    expect(stepHqCellForComponent(state, 0, true, HUB, 10, 60, 1, 1, W02).dischargePerS).toBe(30); // 50 E/s deficit
    expect(state.entities.cols.cell[hq]).toBeCloseTo(94, 4);
    expect(stepHqCellForComponent(state, 0, true, HUB, 10, 13, 0, 2, W02).dischargePerS).toBe(3);
    expect(state.entities.cols.cell[hq]).toBeCloseTo(94, 4); // dtTicks 0: reported, not written
    setHqCellEnergy(state, hq, 1);
    expect(stepHqCellForComponent(state, 0, true, HUB, 10, 60, 1, 3, W02).dischargePerS).toBeCloseTo(5, 4); // 1 E in 0.2 s
    expect(state.entities.cols.cell[hq]).toBe(0);
    expect(stepHqCellForComponent(state, 0, false, [], 10, 60, 1, 4, W02).linked).toBe(false); // not the Hub's component
  });

  it('stepHq stops the free recharge while the W02 grid owns the cell; W01 data or no built Hub keep it', () => {
    const linked = colony({ q: 2, r: 0 });
    setHqCellEnergy(linked.state, linked.hq, 100);
    expect(hqCellGridLinked(linked.state, 0, W02)).toBe(true);
    stepHq(linked.state, { tick: 1, dt: 1, data: W02 });
    expect(linked.state.entities.cols.cell[linked.hq]).toBe(100);

    expect(hqCellGridLinked(linked.state, 0, W01)).toBe(false);
    stepHq(linked.state, { tick: 2, dt: 1, data: W01 });
    expect(linked.state.entities.cols.cell[linked.hq]).toBeCloseTo(104, 4); // W01: 20 E/s fast recharge at the Hub

    const building = colony({ q: 2, r: 0 }, ENTITY_STATE.constructing);
    expect(hqCellGridLinked(building.state, 0, W02)).toBe(false);
  });
});
