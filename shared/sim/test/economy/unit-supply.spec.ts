import { parseWaves, type ResourceKey } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyEnvironmentState, combatServiceFactor, compileData, createRegistryPipeline, createState, creditResource, enqueueQueueTask, ensureColonyLedger,
  ENTITY_KIND, ENTITY_STATE, environmentFromPlanetTime, getColonyStock, getLogisticsView, getUnitRecord, insertRow, setBlob, setPlanetTime, step,
  suppliedCombatFactorBp, withSuppliedCadence, issueUnitCommand, type LedgerPosting, type PlanetState, type SimCommand, type StepContext, type UnitCtx,
} from '../../src';
import { attackCommand } from '../../src/units/commands/attack';
import { readyBuilder } from '../helpers/builder';

/** W13-54: reserve mode, deployment recipe/delay, supplied cadence. Window = 300 ticks, grace 3 windows, deploy delay 10 s = 50 ticks. */
const WINDOW = 300;

function setup(stock: Partial<Record<ResourceKey, number>>) {
  const flags = parseWaves('..13');
  const data = compileData(flags);
  const state = createState({ planetId: 'p-w13-54', planetType: 'temperate', seed: 'w13-54', radius: 12 });
  setPlanetTime(state, { timeOfDay: 12, timeScale: 0 }, 0, data);
  applyEnvironmentState(state, environmentFromPlanetTime(state, data, false, 0), 0);
  state.colonies[0] = { index: 0, id: 'col_0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 };
  creditAll(state, stock);
  const ids: Record<string, number> = {};
  const put = (name: string, kind: number, q: number, r: number, w: number, hp: number): void => {
    const cols = state.entities.cols;
    const id = state.meta.nextEntityId++;
    const row = insertRow(state.entities, id, 0);
    cols.kind[row] = kind; cols.owner[row] = 0; cols.tier[row] = 1; cols.q[row] = q; cols.r[row] = r; cols.x[row] = q; cols.y[row] = r;
    cols.footprintW[row] = w; cols.footprintD[row] = w; cols.shedGroup[row] = 4; cols.hp[row] = hp; cols.hpMax[row] = hp;
    cols.state[row] = ENTITY_STATE.idle;
    ids[name] = id;
  };
  put('hub', ENTITY_KIND.commandHub, 0, 0, 3, 1500);
  for (let i = 0; i < 3; i++) put(`solar${i}`, ENTITY_KIND.solar, 3 + i * 3, -4, 2, 400);
  put('unit', ENTITY_KIND.worker, 2, 4, 1, 100);
  const pipeline = createRegistryPipeline({ flags, data });
  const postings: LedgerPosting[] = [];
  const run = (n = 1, cmds: SimCommand[] = []): string[] => {
    let codes: string[] = [];
    for (let i = 0; i < n; i++) {
      const res = step(state, i === 0 ? cmds : [], 1, pipeline);
      postings.push(...res.postings);
      if (i === 0) codes = res.outcomes.map((o) => o.code ?? 'ok');
    }
    return codes;
  };
  return { state, run, postings, ids };
}

function creditAll(state: PlanetState, stock: Partial<Record<ResourceKey, number>>): void {
  const col = ensureColonyLedger(state.colonies[0]!);
  for (const [k, v] of Object.entries(stock)) creditResource(col, k as ResourceKey, v, 0);
}
const reserve = (id: number, on: boolean, n = 1): SimCommand =>
  ({ commandId: `r${id}_${on}_${n}`, kind: 'unitReserve', colonyIndex: 0, source: 'player', args: { entityIds: [id], reserve: on } }) as SimCommand;
const stock = (s: PlanetState, k: ResourceKey): number => getColonyStock(s, 0)[k];
const hpOf = (t: ReturnType<typeof setup>): number => { const c = t.state.entities.cols; return c.hp[c.id.findIndex((v, i) => i < t.state.entities.count && v === t.ids.unit)]!; };

describe('W13-54 combat service factor', () => {
  it('is max(min, ratio), clamped to [0, 1]', () => {
    expect(combatServiceFactor(0, 5000)).toBe(5000);
    expect(combatServiceFactor(3000, 5000)).toBe(5000);
    expect(combatServiceFactor(7000, 5000)).toBe(7000);
    expect(combatServiceFactor(20000, 5000)).toBe(10000);
    expect(combatServiceFactor(-5, 5000)).toBe(5000);
  });

  it('scales attack DPS once through the wrapped command, never below the floor; W13 off is untouched', () => {
    let seen = 0;
    const fake = { ...attackCommand, work: (u: UnitCtx) => { seen = u.stats.dps; return 'running' as const; } };
    const wrapped = withSuppliedCadence(fake);
    const state = createState({ planetId: 'p', planetType: 'temperate', seed: 's', radius: 4 });
    setBlob(state, 'logistics', { v: 1, colonies: { '0': { window: null, settledKey: '', entities: { '9': { reserve: {}, graceLeftTicks: 0, ratioBp: 0, status: 'partial' } } } } }, 0);
    const data = compileData(parseWaves('..13'));
    const mk = (flags: string): UnitCtx => ({ state, ctx: { flags: parseWaves(flags), data } as unknown as StepContext, owner: 0, id: 9, stats: { dps: 10 } } as unknown as UnitCtx);
    wrapped.work!(mk('..13'), { kind: 'attack', source: 'player', targetId: 1 });
    expect(seen).toBe(5); // floor 0.5 at ratio 0
    wrapped.work!(mk('..12'), { kind: 'attack', source: 'player', targetId: 1 });
    expect(seen).toBe(10);
    expect(suppliedCombatFactorBp(state, mk('..13').ctx, 0, 9)).toBe(5000);
  });
});

describe('W13-54 reserve mode', () => {
  it('reserve stops work and keeps ownership, slots and HP; movement stays possible; no HP loss from missing supply', () => {
    const t = setup({ 'bio.water': 50, 'metals.t1': 50 });
    t.run(2);
    expect(t.run(1, [reserve(t.ids.unit!, true)])).toEqual(['ok']);
    expect(getUnitRecord(t.state, t.ids.unit!)!.reserve).toMatchObject({ mode: 'reserve' });
    const c = t.state.colonies[0]!;
    const supplyBefore = JSON.stringify(c.supply);
    expect(t.run(1, [{ commandId: 'mv', kind: 'moveUnit', colonyIndex: 0, source: 'player', args: { entityId: t.ids.unit, q: 4, r: 4 } } as SimCommand])).toEqual(['ok']);
    t.run(WINDOW * 5); // supply starved: stock gone, grace over; the unit still loses no HP and keeps its slot
    expect(hpOf(t)).toBe(100);
    expect(JSON.stringify(c.supply)).toBe(supplyBefore);
    const cols = t.state.entities.cols;
    expect(cols.owner[cols.id.findIndex((v, i) => i < t.state.entities.count && v === t.ids.unit)]).toBe(0);
  });

  it('toggling cannot dodge the activation cost or the delay, and charges once per activation', () => {
    const t = setup({ 'bio.water': 50, 'metals.t1': 50 });
    t.run(2);
    t.run(1, [reserve(t.ids.unit!, true)]);
    const before = stock(t.state, 'metals.t1');
    expect(t.run(1, [reserve(t.ids.unit!, false)])).toEqual(['ok']);
    expect(stock(t.state, 'metals.t1')).toBe(before - 1);
    // asking again while deploying is a no-op: no second charge
    t.run(1, [reserve(t.ids.unit!, false, 2)]);
    expect(stock(t.state, 'metals.t1')).toBe(before - 1);
    expect(getUnitRecord(t.state, t.ids.unit!)!.reserve).toMatchObject({ mode: 'activating' });
    t.run(30);
    expect(getUnitRecord(t.state, t.ids.unit!)!.reserve).toBeDefined(); // delay (50 ticks) not over
    t.run(30);
    expect(getUnitRecord(t.state, t.ids.unit!)!.reserve).toBeUndefined();
    // every reserve/activate cycle pays again
    t.run(1, [reserve(t.ids.unit!, true, 3)]);
    t.run(1, [reserve(t.ids.unit!, false, 3)]);
    expect(stock(t.state, 'metals.t1')).toBe(before - 2);
    expect(t.postings.filter((p) => p.reason === 'logistics.activate')).toHaveLength(2);
  });

  it('activation is refused without the recipe and the unit stays in reserve', () => {
    const t = setup({});
    t.run(2);
    t.run(1, [reserve(t.ids.unit!, true)]);
    expect(t.run(1, [reserve(t.ids.unit!, false)])).toEqual(['insufficient_resources']);
    expect(getUnitRecord(t.state, t.ids.unit!)!.reserve).toMatchObject({ mode: 'reserve' });
  });

  it('no grace refill by cycling reserve: an exhausted entity stays exhausted after toggles', () => {
    const t = setup({ 'bio.water': 1 });
    t.run(2);
    t.run(WINDOW * 5);
    const id = String(t.ids.unit);
    expect(getLogisticsView(t.state, 0).entities[id]!.graceLeftTicks).toBe(0);
    creditAll(t.state, { 'bio.water': 30, 'metals.t1': 30 });
    for (let i = 0; i < 3; i++) {
      t.run(1, [reserve(t.ids.unit!, true, i)]);
      t.run(1, [reserve(t.ids.unit!, false, i)]);
      t.run(60);
    }
    expect(getLogisticsView(t.state, 0).entities[id]!.graceLeftTicks).toBe(0);
  });

  it('attack, build and terraform commands are rejected while in reserve', () => {
    const t = setup({ 'bio.water': 5, 'metals.t1': 5 });
    t.run(2);
    t.run(1, [reserve(t.ids.unit!, true)]);
    expect(getUnitRecord(t.state, t.ids.unit!)!.current).toBeNull();
    const row = t.state.entities.cols.id.findIndex((v, i) => i < t.state.entities.count && v === t.ids.unit);
    const ctx = { tick: t.state.meta.tick, dt: 1, flags: parseWaves('..13'), data: compileData(parseWaves('..13')), emit: () => {}, record: () => {} } as unknown as StepContext;
    for (const cmd of [{ kind: 'build', orderId: 'x', q: 1, r: 1 }, { kind: 'terraform', orderId: 'y', q: 1, r: 1 }, { kind: 'attack', targetId: 1 }] as const) {
      expect(issueUnitCommand(t.state, row, { ...cmd, source: 'player' }, ctx)).toBe('invalid_args');
    }
    expect(issueUnitCommand(t.state, row, { kind: 'move', source: 'player', q: 3, r: 3 }, ctx)).toBeUndefined();  });
});

describe('W13-54 worker throughput', () => {
  it('building progress scales with the delivered-service ratio of the builder', () => {
    const progress = (bp: number): number => {
      const flags = parseWaves('..02');
      const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
      state.colonies.push(ensureColonyLedger({ index: 0, id: 'c', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
      creditResource(state.colonies[0]!, 'metals.t1', 500, 0);
      creditResource(state.colonies[0]!, 'minerals.t1', 500, 0);
      const hq = readyBuilder(state, [{ q: 2, r: 1 }]);
      setBlob(state, 'logistics', { v: 1, colonies: { '0': { window: null, settledKey: '', entities: { [String(hq)]: { reserve: {}, graceLeftTicks: 0, ratioBp: bp, status: 'partial' } } } } }, 0);
      const r = enqueueQueueTask(state, { colonyIndex: 0, taskId: 'b', costOverride: { 'metals.t1': 20 }, task: { kind: 'build', building: 'solar', q: 2, r: 1 } });
      expect(r.ok).toBe(true);
      const pipeline = createRegistryPipeline({ flags, data: compileData(flags) });
      for (let i = 0; i < 40; i++) step(state, [], 1, pipeline);
      const c = state.entities.cols;
      let best = 0;
      for (let i = 0; i < state.entities.count; i++) if (c.kind[i] === ENTITY_KIND.solar) best = Math.max(best, c.progress[i]!);
      return best;
    };
    const full = progress(10000), half = progress(5000);
    expect(full).toBeGreaterThan(0);
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.6);
  });
});
