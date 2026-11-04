import { parseWaves, type ResourceKey } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyEnvironmentState,
  compileData,
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyCargoState,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  environmentFromPlanetTime,
  getColonyPrestige,
  getColonyStock,
  insertRow,
  setPlanetTime,
  step,
  type LedgerPosting,
  type PlanetState,
  type SimCommand,
  type SimEvent,
} from '../../src';

/** W13-43: the recurring prestige project (queue) and the metered cargo transport recipe, against hand-priced rows. */

const PROJECT_COST: Partial<Record<ResourceKey, number>> = { 'metals.t1': 60, 'minerals.t1': 40, 'bio.water': 30, 'minerals.t2': 8 };
const PROJECT_TICKS = 600; // 120 s at 200 ms per tick

function setup(waves: string, stock: Partial<Record<ResourceKey, number>>) {
  const flags = parseWaves(waves);
  const data = compileData(flags);
  const state = createState({ planetId: 'p-w13-43', planetType: 'temperate', seed: 'w13-43', radius: 10 });
  setPlanetTime(state, { timeOfDay: 12 }, 0, data);
  applyEnvironmentState(state, environmentFromPlanetTime(state, data, false, 0), 0);
  state.colonies[0] = { index: 0, id: 'col_0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 };
  const col = ensureColonyLedger(state.colonies[0]);
  for (const [k, v] of Object.entries(stock)) creditResource(col, k as ResourceKey, v, 0);
  const put = (kind: number, q: number, r: number, w: number, d: number, hp: number, shed: number): void => {
    const cols = state.entities.cols;
    const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
    cols.kind[row] = kind; cols.owner[row] = 0; cols.tier[row] = 1; cols.q[row] = q; cols.r[row] = r;
    cols.footprintW[row] = w; cols.footprintD[row] = d; cols.shedGroup[row] = shed; cols.hp[row] = hp; cols.hpMax[row] = hp;
    cols.state[row] = ENTITY_STATE.active;
  };
  put(ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500, 4);
  put(ENTITY_KIND.solar, 3, 0, 2, 2, 400, 4);
  put(ENTITY_KIND.solar, 0, 3, 2, 2, 400, 4);
  put(ENTITY_KIND.solar, 3, -3, 2, 2, 400, 4);
  put(ENTITY_KIND.tradeHub, -3, 0, 2, 2, 650, 2);
  const pipeline = createRegistryPipeline({ flags, data });
  const postings: LedgerPosting[] = [];
  const events: SimEvent[] = [];
  const run = (cmds: SimCommand[], dt = 1): string[] => {
    const res = step(state, cmds, dt, pipeline);
    postings.push(...res.postings);
    events.push(...res.events);
    return res.outcomes.map((o) => o.code ?? 'ok');
  };
  return { state, run, postings, events };
}

const cmd = (commandId: string, kind: string, args: Record<string, unknown>, source: SimCommand['source'] = 'player'): SimCommand =>
  ({ commandId, kind, colonyIndex: 0, source, args }) as SimCommand;
const stockOf = (s: PlanetState, k: ResourceKey): number => getColonyStock(s, 0)[k];
const RICH = { 'metals.t1': 400, 'minerals.t1': 300, 'bio.water': 200, 'minerals.t2': 40, 'bio.biomass': 100 } as const;

function runProject(t: ReturnType<typeof setup>, id: string): void {
  expect(t.run([cmd(id, 'enqueueTask', { project: { project: 'project.survey_array' } })])).toEqual(['ok']);
  for (let i = 0; i < PROJECT_TICKS + 5; i++) t.run([]);
}

describe('W13-43 prestige project through the Hub order queue', () => {
  it('consumes its inputs, adds one prestige fact, pays no cash; repeating consumes anew', () => {
    const t = setup('..13', RICH);
    const before = { ...getColonyStock(t.state, 0) };
    runProject(t, 'p1');
    for (const [k, v] of Object.entries(PROJECT_COST) as [ResourceKey, number][]) expect(stockOf(t.state, k)).toBe(before[k] - v);
    expect(getColonyPrestige(t.state, 0)).toMatchObject({ completed: 1, byProject: { 'project.survey_array': 1 } });
    expect(t.events.filter((e) => e.kind === 'prestigeCompleted')).toHaveLength(1);
    expect(t.events.find((e) => e.kind === 'prestigeCompleted')!.data).toMatchObject({ project: 'project.survey_array', count: 1 });
    // no reward: the only postings are the progressive payments, every leg a withdrawal from the colony
    expect(new Set(t.postings.map((p) => p.reason))).toEqual(new Set(['construction.spend']));
    expect(t.postings.every((p) => p.legs.filter((l) => l.account === 'colony:0').every((l) => l.delta < 0))).toBe(true);

    runProject(t, 'p2');
    for (const [k, v] of Object.entries(PROJECT_COST) as [ResourceKey, number][]) expect(stockOf(t.state, k)).toBe(before[k] - 2 * v);
    expect(getColonyPrestige(t.state, 0).completed).toBe(2);
    expect(t.events.filter((e) => e.kind === 'prestigeCompleted').at(-1)!.data).toMatchObject({ count: 2 });
  });

  it('pins the compiled-data hash on the job and refunds 50 % of what was paid on cancel', () => {
    const t = setup('..13', RICH);
    t.run([cmd('p1', 'enqueueTask', { project: { project: 'project.survey_array' } })]);
    for (let i = 0; i < 299; i++) t.run([]); // half way: half the cost is paid
    const entry = (t.state.colonies[0]!.unitQueue as { pinned?: { dataHash: string }; spentCost?: Record<string, number>; task: { kind: string }; taskId: string }[])[0]!;
    expect(entry.task.kind).toBe('project');
    expect(entry.pinned?.dataHash).toMatch(/\S+/);
    const paid = Math.round(entry.spentCost!['metals.t1']!);
    expect(paid).toBeGreaterThan(20);
    const mid = stockOf(t.state, 'metals.t1');
    t.run([cmd('c1', 'cancelTask', { taskId: entry.taskId })]);
    const back = stockOf(t.state, 'metals.t1') - mid;
    expect(Math.abs(back - paid / 2)).toBeLessThanOrEqual(1); // whole units, half of the paid share (residual keeps the rest)
    expect(getColonyPrestige(t.state, 0).completed).toBe(0);
  });

  it('is rejected with W13 off (wave_disabled) and for an unknown project; waits on resources when short', () => {
    const off = setup('..12', RICH);
    expect(off.run([cmd('p1', 'enqueueTask', { project: { project: 'project.survey_array' } })])).toEqual(['wave_disabled']);
    const on = setup('..13', RICH);
    expect(on.run([cmd('p1', 'enqueueTask', { project: { project: 'project.nope' } })])).toEqual(['invalid_args']);
    const poor = setup('..13', { ...RICH, 'minerals.t2': 0 });
    poor.run([cmd('p1', 'enqueueTask', { project: { project: 'project.survey_array' } })]);
    for (let i = 0; i < 10; i++) poor.run([]);
    expect(getColonyPrestige(poor.state, 0).completed).toBe(0);
    expect(stockOf(poor.state, 'metals.t1')).toBe(400); // nothing paid while an input is missing
  });
});

const EXPORT = (id: string, amount: number): SimCommand => cmd(id, 'cargo.export', { colonyId: 'col_0', resource: 'metals.t1', amount });
const SETTLE = (id: string, ref: string, direction: 'export' | 'import', ok: boolean): SimCommand =>
  cmd(id, 'cargo.settled', { ref, ok, direction }, 'dev');

describe('W13-43 metered transport recipe (2 biomass per started 100 units)', () => {
  it('charges once per operation as the service runs: 250 units is 3 blocks = 6 biomass, kept on settle, no recharge on a retry', () => {
    const t = setup('..13', { 'metals.t1': 400, 'bio.biomass': 100 });
    expect(t.run([EXPORT('x1', 250)])).toEqual(['ok']);
    const cargo = ensureColonyCargoState(t.state.colonies[0]!);
    const ref = Object.keys(cargo.pendingMint)[0]!;
    expect(stockOf(t.state, 'bio.biomass')).toBe(94); // 100 - 3 * 2, reserved
    expect(cargo.transportReserve[ref]).toEqual({ 'bio.biomass': 6 });
    t.run([SETTLE('s1', ref, 'export', true)]);
    expect(cargo.transportReserve[ref]).toBeUndefined();
    expect(stockOf(t.state, 'bio.biomass')).toBe(94); // charged for the service that ran
    t.run([SETTLE('s1b', ref, 'export', true)]); // the same settlement again (a retried mint)
    expect(stockOf(t.state, 'bio.biomass')).toBe(94);
    expect(t.postings.filter((p) => p.reason === 'transport.reserve')).toHaveLength(1);
  });

  it('returns the inputs when the chain fails before service, and the cargo too', () => {
    const t = setup('..13', { 'metals.t1': 400, 'bio.biomass': 100 });
    t.run([EXPORT('x1', 100)]);
    const ref = Object.keys(ensureColonyCargoState(t.state.colonies[0]!).pendingMint)[0]!;
    expect(stockOf(t.state, 'bio.biomass')).toBe(98);
    t.run([SETTLE('s1', ref, 'export', false)]);
    expect(stockOf(t.state, 'bio.biomass')).toBe(100);
    expect(stockOf(t.state, 'metals.t1')).toBe(400);
    expect(t.postings.filter((p) => p.reason === 'transport.release')).toHaveLength(1);
  });

  it('rejects insufficient_resources when the inputs are short, changing nothing', () => {
    const t = setup('..13', { 'metals.t1': 400, 'bio.biomass': 5 });
    expect(t.run([EXPORT('x1', 250)])).toEqual(['insufficient_resources']); // needs 6
    expect(stockOf(t.state, 'metals.t1')).toBe(400);
    expect(stockOf(t.state, 'bio.biomass')).toBe(5);
    expect(t.run([EXPORT('x2', 100)])).toEqual(['ok']); // 2 biomass is enough
  });

  it('charges an import the same way, kept on ok and returned on failure', () => {
    const t = setup('..13', { 'bio.biomass': 50, 'metals.t1': 10 });
    ensureColonyCargoState(t.state.colonies[0]!).inOrbit['metals.t1'] = 200;
    t.run([cmd('i1', 'cargo.import', { colonyId: 'col_0', resource: 'metals.t1', amount: 150 })]);
    const cargo = ensureColonyCargoState(t.state.colonies[0]!);
    const ref = Object.keys(cargo.pendingImport)[0]!;
    expect(stockOf(t.state, 'bio.biomass')).toBe(46); // 2 blocks
    t.run([SETTLE('s1', ref, 'import', true)]);
    expect(stockOf(t.state, 'bio.biomass')).toBe(46);
    expect(stockOf(t.state, 'metals.t1')).toBe(160);
    t.run([cmd('i2', 'cargo.import', { colonyId: 'col_0', resource: 'metals.t1', amount: 50 })]);
    const ref2 = Object.keys(ensureColonyCargoState(t.state.colonies[0]!).pendingImport)[0]!;
    expect(stockOf(t.state, 'bio.biomass')).toBe(44);
    t.run([SETTLE('s2', ref2, 'import', false)]);
    expect(stockOf(t.state, 'bio.biomass')).toBe(46);
  });

  it('with the waves through W12 export and import behave exactly as before: no charge, no reservation', () => {
    const t = setup('..12', { 'metals.t1': 400 });
    expect(t.run([EXPORT('x1', 250)])).toEqual(['ok']);
    const cargo = ensureColonyCargoState(t.state.colonies[0]!);
    expect(cargo.transportReserve).toEqual({});
    expect(t.postings.some((p) => p.reason.startsWith('transport.'))).toBe(false);
    expect(stockOf(t.state, 'metals.t1')).toBe(150);
  });
});
