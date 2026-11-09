import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  COARSE_DT,
  ENTITY_KIND,
  ENTITY_STATE,
  TICK_MS,
  TICKS_PER_SECOND,
  createState,
  ensureColonyLedger,
  insertRow,
  resourceValue,
  setPlanetTime,
  SimHost,
  type PlanetState,
} from '../../src';

/** 10 wall minutes at 5 ticks per second (`TICK_MS` 200). The restart fast-run gap. */
const TEN_MIN_TICKS = 10 * 60 * TICKS_PER_SECOND;
const FLAGS = parseWaves('..09');

function spawn(state: PlanetState, kind: number, q: number, r: number, w: number, d: number, hp: number): void {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const cols = state.entities.cols;
  cols.kind[row] = kind;
  cols.owner[row] = 0;
  cols.q[row] = q;
  cols.r[row] = r;
  cols.footprintW[row] = w;
  cols.footprintD[row] = d;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.active;
}

/** Cap stays under 1500 so a hub with no depot does not clamp it back to 500. */
function widenCaps(state: PlanetState): void {
  const colony = ensureColonyLedger({
    index: 0, id: 'col-0', name: 'Alpha', color: 0xff6b00, status: 'active', changedAt: 0,
  });
  colony.stock['bio.biomass'] = 400;
  colony.caps.metals = 1499;
  colony.caps.minerals = 1499;
  colony.caps.bio = 1499;
  state.colonies.push(colony);
}

/** Water extractor plus the power that keeps it online. Noon is pinned so solar output does not drift. */
function boot(): SimHost {
  const state = createState({ planetId: 'p-w09-32', planetType: 'temperate', seed: 'w09-32', radius: 8 });
  widenCaps(state);
  spawn(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);
  spawn(state, ENTITY_KIND.solar, 3, 0, 2, 2, 400);
  spawn(state, ENTITY_KIND.thermal, 0, 3, 2, 2, 450);
  spawn(state, ENTITY_KIND.waterExtractor, -3, 0, 2, 2, 480);
  setPlanetTime(state, { timeOfDay: 12, timeScale: 0 }, 0);
  const sim = new SimHost({ flags: FLAGS });
  sim.load(state);
  return sim;
}

function run(sim: SimHost, steps: number, dt: number): void {
  for (let i = 0; i < steps; i++) sim.step(dt);
}

function stocks(sim: SimHost): { water: number; biomass: number; pollution: number } {
  const col = ensureColonyLedger(sim.state.colonies[0]!);
  return {
    water: resourceValue(col, 'bio.water'),
    biomass: resourceValue(col, 'bio.biomass'),
    pollution: Number(col.pollution ?? 0),
  };
}

describe('W09-32 fast-run of 10 min matches fine ticks', () => {
  it('600 coarse steps (dt=5) match 3000 fine steps (dt=1) of water stock', () => {
    expect(TICK_MS).toBe(200);
    expect(TEN_MIN_TICKS).toBe(3000);
    expect(TEN_MIN_TICKS % COARSE_DT).toBe(0);

    const built = boot();
    const fine = built.clone();
    const coarse = built.clone();
    run(fine, TEN_MIN_TICKS, 1);
    run(coarse, TEN_MIN_TICKS / COARSE_DT, COARSE_DT);

    const a = stocks(fine);
    const b = stocks(coarse);
    expect(fine.tick).toBe(TEN_MIN_TICKS);
    expect(coarse.tick).toBe(TEN_MIN_TICKS);
    expect(b).toEqual(a);
    // A step that forgot to multiply by dt lands near a fifth of this and under the family cap.
    expect(a.water).toBeGreaterThan(400);
    expect(a.pollution).toBeGreaterThan(0);
  });
});
