import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  COARSE_DT,
  compileData,
  createState,
  dataRow,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyLedger,
  getPlanetTime,
  getWeatherState,
  indexOf,
  insertRow,
  MAX_CATCHUP,
  placeMetalsExtractor,
  PlanetScheduler,
  resourceValue,
  rowOf,
  saveWeatherState,
  setHqCellEnergy,
  setPlanetTime,
  setTileDeposit,
  SimHost,
  spawnHqUnit,
  type PlanetState,
} from '../../src';

/** 3600 ticks: 720 coarse steps of dt=5, or 3600 fine steps of dt=1. 12 min at 5 TPS, not one solar hour. */
const TICKS = 3600;
const FLAGS = parseWaves('..09');
const DATA = compileData(FLAGS);

const num = (table: string, id: string, field: string): number => Number(dataRow(DATA, table, id)[field]);

function spawn(state: PlanetState, kind: number, q: number, r: number, w: number, d: number, hp: number): number {
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
  return id;
}

/** Cap stays under 1500 so a hub with no depot does not clamp it back to 500 (`recomputeFamilyCaps`). */
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

function armOverload(state: PlanetState, entityId: number, untilTick: number): void {
  const row = rowOf(state.entities, entityId);
  state.entities.cols.state[row] = ENTITY_STATE.offlineOverload;
  const weather = getWeatherState(state);
  weather.overloadUntilByEntity[entityId] = untilTick;
  saveWeatherState(state, weather, state.meta.tick);
}

function bootProducer(overloadUntil: number): { sim: SimHost; spareId: number } {
  const state = createState({ planetId: 'p-coarse', planetType: 'temperate', seed: 'w09-04', radius: 8 });
  widenCaps(state);
  spawn(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);
  spawn(state, ENTITY_KIND.solar, 3, 0, 2, 2, 400);
  spawn(state, ENTITY_KIND.thermal, 0, 3, 2, 2, 450);
  spawn(state, ENTITY_KIND.waterExtractor, -3, 0, 2, 2, 480);
  const spareId = spawn(state, ENTITY_KIND.capacitor, 2, 2, 2, 2, 300);
  // Pinned noon: daylight is constant, so the solar stays a steady source. Water is the stock
  // counter: a finite metals tile in the last 10 bp is read as a multiplier and would not match.
  setPlanetTime(state, { timeOfDay: 12, timeScale: 0 }, 0);
  armOverload(state, spareId, overloadUntil);
  const sim = new SimHost({ flags: FLAGS });
  sim.load(state);
  return { sim, spareId };
}

function run(sim: SimHost, steps: number, dt: number): void {
  for (let i = 0; i < steps; i++) sim.step(dt);
}

function picture(sim: SimHost, spareId: number): Record<string, number> {
  const col = ensureColonyLedger(sim.state.colonies[0]!);
  const weather = getWeatherState(sim.state);
  const cols = sim.state.entities.cols;
  const spareRow = rowOf(sim.state.entities, spareId);
  let solar = -1;
  for (let r = 0; r < sim.state.entities.count; r++) if (cols.kind[r] === ENTITY_KIND.solar) solar = cols.state[r]!;
  return {
    tick: sim.tick,
    hour: getPlanetTime(sim.state, sim.pipeline.config.data).hour,
    water: resourceValue(col, 'bio.water'),
    biomass: resourceValue(col, 'bio.biomass'),
    pollution: Number(col.pollution ?? 0),
    spare: cols.state[spareRow] ?? -1,
    overload: weather.overloadUntilByEntity[spareId] ?? 0,
    solar,
    cap: col.caps.bio,
    brownoutTicks: Number(col.brownoutTicks ?? 0),
  };
}

function bootBrownout(): SimHost {
  const state = createState({ planetId: 'p-brown', planetType: 'temperate', seed: 'w09-04-brown', radius: 10 });
  const founder = num('hub', 't1', 'founderCoreGenPerS');
  const hubDrain = num('hub', 't1', 'powerDrainPerS');
  const extDrain = num('economyT1Basic', 'metalsExtractor', 'powerDrainPerS');
  const count = Math.floor((founder - hubDrain) / extDrain) + 1;
  spawn(state, ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500);
  const hq = rowOf(state.entities, spawnHqUnit(state, { owner: 0, q: 2, r: -1 }));
  const sites: ReadonlyArray<readonly [number, number]> = [[3, 0], [-5, 0], [0, 4], [0, -5]];
  for (const [q, r] of sites.slice(0, count)) {
    for (const [dq, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      setTileDeposit(state, indexOf(state.grid.radius, q + dq, r + dr), DEPOSIT.metals, 10000, 0);
    }
    const placed = placeMetalsExtractor(state, { owner: 0, q, r });
    if (!placed.ok) throw new Error(placed.detail);
  }
  setHqCellEnergy(state, hq, 0);
  setPlanetTime(state, { timeOfDay: 0, timeScale: 0 }, 0);
  const sim = new SimHost({ flags: FLAGS });
  sim.load(state);
  return sim;
}

const brownoutTicksOf = (sim: SimHost): number => Number(sim.state.colonies[0]?.brownoutTicks ?? 0);

describe('W09-04 coarse dt matches fine dt over the same tick span', () => {
  it('720 coarse steps match 3600 fine steps of production, pollution and the pinned solar hour', () => {
    const built = bootProducer(75); // 75 ticks = 15 s, a multiple of COARSE_DT, so expiry lands on a coarse step
    const fine = built.sim.clone();
    const coarse = built.sim.clone();
    run(fine, TICKS, 1);
    run(coarse, TICKS / COARSE_DT, COARSE_DT);

    const a = picture(fine, built.spareId);
    const b = picture(coarse, built.spareId);
    expect(b.tick).toBe(TICKS);
    expect(b).toEqual(a);
    expect(a.hour).toBe(12);
    expect(a.cap).toBe(1499);
    expect(a.solar).toBe(ENTITY_STATE.active);
    expect(a.spare).toBe(ENTITY_STATE.active);
    expect(a.overload).toBe(0);
    expect(a.brownoutTicks).toBe(0);
    // Headroom under the cap: a step that forgot to multiply by dt would stop near a fifth of these.
    expect(a.water).toBeGreaterThan(400);
    expect(a.pollution).toBeGreaterThan(400);
    expect(a.biomass).toBeLessThan(400);
  });

  it('dt=5 on a lightning-overload boundary matches five dt=1 steps, including that second of production', () => {
    const built = bootProducer(COARSE_DT);
    const fine = built.sim.clone();
    const coarse = built.sim.clone();
    run(fine, COARSE_DT, 1);
    run(coarse, 1, COARSE_DT);

    const a = picture(fine, built.spareId);
    const b = picture(coarse, built.spareId);
    expect(b).toEqual(a);
    expect(a.tick).toBe(COARSE_DT);
    expect(a.spare).toBe(ENTITY_STATE.active);
    expect(a.overload).toBe(0);
    expect(a.water).toBeGreaterThan(0);
    expect(a.pollution).toBeGreaterThan(0);
  });

  it('dt=5 on the energy-collapse boundary matches five dt=1 steps', () => {
    const collapseAt = num('economyT1Basic', 'dayCycle', 'energyCollapseAfterS');
    expect(collapseAt % COARSE_DT).toBe(0);
    const sim = bootBrownout();
    let guard = 0;
    while (brownoutTicksOf(sim) < collapseAt - COARSE_DT) {
      sim.step(1);
      expect(++guard).toBeLessThan(collapseAt + 20);
    }
    expect(brownoutTicksOf(sim)).toBe(collapseAt - COARSE_DT);
    expect(sim.state.colonies[0]?.energyCollapsed).not.toBe(true);

    const fine = sim.clone();
    const coarse = sim.clone();
    run(fine, COARSE_DT, 1);
    run(coarse, 1, COARSE_DT);
    expect(brownoutTicksOf(fine)).toBe(collapseAt);
    expect(brownoutTicksOf(coarse)).toBe(brownoutTicksOf(fine));
    expect(fine.tick).toBe(coarse.tick);
    expect(fine.state.colonies[0]?.energyCollapsed).toBe(true);
    expect(coarse.state.colonies[0]?.energyCollapsed).toBe(true);
    expect(fine.events.filter((e) => e.kind === 'energyCollapse')).toHaveLength(1);
    expect(coarse.events.filter((e) => e.kind === 'energyCollapse')).toHaveLength(1);
  });
});

describe('W09-04 coarse dt clock and catch-up cap', () => {
  it('a moving solar clock matches after the same tick advance', () => {
    const sim = new SimHost({ flags: FLAGS });
    sim.load(createState({ planetId: 'p-clock', planetType: 'temperate', seed: 'w09-04-clock', radius: 4 }));
    const fine = sim.clone();
    const coarse = sim.clone();
    run(fine, COARSE_DT, 1);
    run(coarse, 1, COARSE_DT);
    const data = sim.pipeline.config.data;
    expect(fine.tick).toBe(coarse.tick);
    expect(getPlanetTime(coarse.state, data)).toEqual(getPlanetTime(fine.state, data));
  });

  it('coarse catch-up still takes at most 5 steps per pass and does not drop due slots', () => {
    let now = 0;
    const steps: number[] = [];
    const s = new PlanetScheduler({
      now: () => now,
      schedule: () => () => undefined,
      step: (_id, dt) => { steps.push(dt); },
    });
    s.add('pl', 'coarse');
    now = 10_000; // slots due at 0,1000,…,10000
    let total = 0;
    for (let i = 0; i < 8; i++) {
      const rep = s.runPass();
      total += rep.steps;
      expect(rep.maxPlanetSteps).toBeLessThanOrEqual(MAX_CATCHUP);
      expect(rep.steps).toBeLessThanOrEqual(MAX_CATCHUP);
      if (rep.maxLag === 0) break;
    }
    expect(total).toBe(11);
    expect(steps.every((dt) => dt === COARSE_DT)).toBe(true);
    expect(COARSE_DT).toBe(5);
  });
});
