import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  cancelQueueTask,
  checkUnitSupply,
  computeColonySupply,
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueQueueTask,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyQueue,
  insertRow,
  step,
  syncColonySupply,
  type ColonySupply,
  type PlanetState,
  type SimCommand,
} from '../../src';

/** Unit supply (owner feedback W03 #2): one module (`systems/supply`) computes, syncs and enforces it. */

const pipeline = () => createRegistryPipeline({ flags: parseWaves('..03') });

function planet(seed: string): PlanetState {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 12 });
  const colony = ensureColonyLedger({ index: 0, id: 'col-0', name: 'Alpha', color: 0xff6b00, status: 'active', changedAt: 0 });
  state.colonies.push(colony);
  for (const k of ['metals.t1', 'minerals.t1', 'bio.biomass'] as const) creditResource(colony, k, 400, 0);
  return state;
}

function addEntity(state: PlanetState, kind: number, opts: { owner?: number; q?: number; r?: number; state?: number; hp?: number; fp?: number } = {}): number {
  const cols = state.entities.cols;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  cols.kind[row] = kind;
  cols.owner[row] = opts.owner ?? 0;
  cols.q[row] = opts.q ?? 0;
  cols.r[row] = opts.r ?? 0;
  cols.footprintW[row] = opts.fp ?? 0;
  cols.footprintD[row] = opts.fp ?? 0;
  cols.hp[row] = opts.hp ?? 100;
  cols.hpMax[row] = 100;
  cols.state[row] = opts.state ?? ENTITY_STATE.idle;
  return row;
}

const addHub = (s: PlanetState) => addEntity(s, ENTITY_KIND.commandHub, { fp: 3, hp: 1500, state: ENTITY_STATE.active });
const addDepot = (s: PlanetState, q: number, st: number = ENTITY_STATE.active, r = 4) => addEntity(s, ENTITY_KIND.supplyDepot, { q, r, fp: 2, hp: 600, state: st });
const addUnits = (s: PlanetState, kind: number, n: number) => {
  for (let i = 0; i < n; i++) addEntity(s, kind, { q: -4, r: i - 4 });
};
const harvesters = (s: PlanetState) => {
  let n = 0;
  for (let r = 0; r < s.entities.count; r++) if (s.entities.cols.kind[r] === ENTITY_KIND.harvester && s.entities.cols.hp[r] > 0) n++;
  return n;
};

function enqueueCmd(id: string, unit: string, count?: number): SimCommand {
  return { colonyIndex: 0, source: 'player', commandId: id, kind: 'enqueueTask', args: { task: { kind: 'buildUnit', unit, ...(count ? { count } : {}) } } } as SimCommand;
}

describe('supply: used / cap computation', () => {
  it('counts alive owned units by their row supply (HQ 0), and the Hub provides the base cap', () => {
    const s = planet('sup-count');
    expect(computeColonySupply(s, 0)).toMatchObject({ used: 0, cap: 0, max: 200, sources: [] }); // no Hub, no cap
    addHub(s);
    addEntity(s, ENTITY_KIND.hq);
    addUnits(s, ENTITY_KIND.harvester, 2);
    addUnits(s, ENTITY_KIND.builder, 1);
    addEntity(s, ENTITY_KIND.harvester, { owner: 1 }); // another colony's unit
    addEntity(s, ENTITY_KIND.harvester, { hp: 0 }); // dead
    expect(computeColonySupply(s, 0)).toEqual({
      used: 3, units: 3, reserved: 0, cap: 10, available: 7, max: 200,
      sources: [{ building: 'commandHub', label: 'Command Hub', count: 1, each: 10, total: 10 }],
    } satisfies ColonySupply);
  });

  it('a finished, powered Supply Depot adds its supplyProvided (+8); one under construction or browned out does not; the cap clamps at supplyCapMax', () => {
    const s = planet('sup-depot');
    addHub(s);
    addDepot(s, 4);
    addDepot(s, 7, ENTITY_STATE.constructing);
    addDepot(s, -6, ENTITY_STATE.offlineBrownout);
    const sup = computeColonySupply(s, 0);
    expect(sup.cap).toBe(18);
    expect(sup.sources).toEqual([
      { building: 'commandHub', label: 'Command Hub', count: 1, each: 10, total: 10 },
      { building: 'supplyDepot', label: 'Supply Depot', count: 1, each: 8, total: 8 },
    ]);
    for (let i = 0; i < 30; i++) addDepot(s, i);
    expect(computeColonySupply(s, 0).cap).toBe(200);
  });

  it('the system writes colony.supply each step, stamping changedAt only when the value changed; a dead unit frees its supply', () => {
    const s = planet('sup-sync');
    addHub(s);
    addUnits(s, ENTITY_KIND.harvester, 3);
    const p = pipeline();
    step(s, [], 1, p);
    expect(s.colonies[0].supply).toMatchObject({ used: 3, cap: 10 });
    const stamped = s.colonies[0].changedAt;
    expect(syncColonySupply(s, 0, stamped + 50)).toMatchObject({ used: 3 });
    expect(s.colonies[0].changedAt).toBe(stamped); // unchanged: no stamp, no delta
    s.entities.cols.hp[1] = 0; // first harvester dies
    step(s, [], 1, p);
    expect(s.colonies[0].supply).toMatchObject({ used: 2, units: 2 });
    expect(s.colonies[0].changedAt).toBe(s.meta.tick);
  });
});

describe('supply: validation and production', () => {
  it('the enqueueTask command rejects a unit over the cap (supply_cap) and an unknown unit (invalid_args)', () => {
    const s = planet('sup-reject');
    addHub(s);
    addUnits(s, ENTITY_KIND.harvester, 10);
    const out = step(s, [enqueueCmd('over', 'harvester'), enqueueCmd('bad', 'tank')], 1, pipeline()).outcomes;
    expect(out.find((o) => o.commandId === 'over')).toMatchObject({ code: 'supply_cap', detail: 'Supply cap reached (10 / 10): build a Supply Depot' });
    expect(out.find((o) => o.commandId === 'bad')?.code).toBe('invalid_args');
    expect(getColonyQueue(s, 0, 'units')).toHaveLength(0);
    expect(enqueueQueueTask(s, { colonyIndex: 0, task: { kind: 'buildUnit', unit: 'tank' } })).toMatchObject({ ok: false, code: 'invalid_args' });
  });

  it('a Supply Depot on the Hub grid lifts the cap: the same order is then accepted and starts', () => {
    const s = planet('sup-depot-accept');
    addHub(s);
    addUnits(s, ENTITY_KIND.harvester, 10);
    addDepot(s, 3, ENTITY_STATE.active, 0); // next to the Hub
    const p = pipeline(); // without the grid: 10 harvesters would brown the depot out (no cap while offline)
    const noGrid = { ...p, systems: p.systems.filter((sys) => sys.id !== 'power.core') };
    const res = step(s, [enqueueCmd('ok', 'harvester')], 1, noGrid);
    expect(res.outcomes[0].code).toBeUndefined();
    expect(getColonyQueue(s, 0, 'units')[0].state).toBe('in_progress');
    expect(s.colonies[0].supply).toMatchObject({ used: 11, units: 10, reserved: 1, cap: 18 });
  });

  it('production reserves supply when it starts; the rest of a batch waits on supply at the cap; a death lets it resume', () => {
    const s = planet('sup-batch');
    addHub(s);
    addUnits(s, ENTITY_KIND.harvester, 8);
    const p = pipeline();
    step(s, [enqueueCmd('batch', 'harvester', 4)], 1, p);
    expect(s.colonies[0].supply).toMatchObject({ used: 9, units: 8, reserved: 1 });
    expect(checkUnitSupply(s, 0, 'builder')).toMatchObject({ ok: true }); // 9 + 1 <= 10
    for (let i = 0; i < 40; i++) step(s, [], 5, p);
    expect(harvesters(s)).toBe(10);
    const entry = getColonyQueue(s, 0, 'units')[0];
    expect(entry).toMatchObject({ state: 'waiting', waitReason: 'supply', waitDetail: 'waiting: supply', remainingCount: 2 });
    expect(s.colonies[0].supply).toMatchObject({ used: 10, reserved: 0, available: 0 });

    s.entities.cols.hp[1] = 0; // a harvester dies -> one slot frees
    step(s, [], 1, p);
    expect(getColonyQueue(s, 0, 'units')[0].state).toBe('in_progress');
    expect(s.colonies[0].supply).toMatchObject({ used: 10, units: 9, reserved: 1 });
  });

  it('cancelling an order in production releases its reservation', () => {
    const s = planet('sup-cancel');
    addHub(s);
    const res = enqueueQueueTask(s, { colonyIndex: 0, taskId: 'one', task: { kind: 'buildUnit', unit: 'builder' } });
    expect(res.ok && res.entry.state).toBe('in_progress');
    expect(computeColonySupply(s, 0)).toMatchObject({ used: 1, reserved: 1 });
    expect(cancelQueueTask(s, 'one', 0).ok).toBe(true);
    expect(computeColonySupply(s, 0)).toMatchObject({ used: 0, reserved: 0 });
  });
});
