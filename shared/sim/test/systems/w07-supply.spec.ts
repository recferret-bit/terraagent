import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  BUILDING_KIND_BY_NAME,
  calculateUnitDemand,
  checkUnitSupply,
  computeColonySupply,
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueQueueTask,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  entityFootprint,
  evaluateColonyPower,
  getColonyQueue,
  insertRow,
  isEconomyBuildingKind,
  resolveEconomyBuildingRow,
  step,
  type PlanetState,
  type SimCommand,
} from '../../src';
import { resolveBuildingRow } from '../../src/systems/economy/buildingRows';

const pipeline = () => createRegistryPipeline({ flags: parseWaves('..07') });

function planet(seed: string): PlanetState {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 12 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
    unlockStage: 3,
  });
  state.colonies.push(colony);
  for (const k of ['metals.t1', 'minerals.t1', 'bio.biomass', 'bio.water'] as const) {
    creditResource(colony, k, 400, 0);
  }
  return state;
}

function addEntity(
  state: PlanetState,
  kind: number,
  opts: { owner?: number; q?: number; r?: number; state?: number; hp?: number; fp?: number } = {},
): number {
  const cols = state.entities.cols;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  cols.kind[row] = kind;
  cols.owner[row] = opts.owner ?? 0;
  cols.q[row] = opts.q ?? 0;
  cols.r[row] = opts.r ?? 0;
  cols.footprintW[row] = opts.fp ?? 0;
  cols.footprintD[row] = opts.fp ?? 0;
  cols.hp[row] = opts.hp ?? 160;
  cols.hpMax[row] = opts.hp ?? 160;
  cols.state[row] = opts.state ?? ENTITY_STATE.idle;
  return row;
}

const addHub = (s: PlanetState) =>
  addEntity(s, ENTITY_KIND.commandHub, { q: 0, r: 0, fp: 3, hp: 1500, state: ENTITY_STATE.active });

const addDca = (s: PlanetState, q = 3, r = 0, st: number = ENTITY_STATE.active) =>
  addEntity(s, ENTITY_KIND.droneControlArray, { q, r, fp: 1, hp: 350, state: st });

const addUnits = (s: PlanetState, kind: number, n: number, st: number = ENTITY_STATE.idle) => {
  const rows: number[] = [];
  for (let i = 0; i < n; i++) rows.push(addEntity(s, kind, { q: -4, r: i - 4, state: st }));
  return rows;
};

function enqueueCmd(id: string, unit: string, count?: number): SimCommand {
  return {
    colonyIndex: 0,
    source: 'player',
    commandId: id,
    kind: 'enqueueTask',
    args: { task: { kind: 'buildUnit', unit, ...(count ? { count } : {}) } },
  } as SimCommand;
}

describe('W07-11 Building rows, footprints & recon power', () => {
  it('resolves W07 building rows, aliases, footprints, and recon power drain', () => {
    expect(BUILDING_KIND_BY_NAME.roboticsFactory).toBe(ENTITY_KIND.roboticsFactory);
    expect(BUILDING_KIND_BY_NAME.droneControlArray).toBe(ENTITY_KIND.droneControlArray);
    expect(BUILDING_KIND_BY_NAME.droneArray).toBe(ENTITY_KIND.droneControlArray);
    expect(BUILDING_KIND_BY_NAME.autocannon).toBe(ENTITY_KIND.autocannon);
    expect(BUILDING_KIND_BY_NAME.turret).toBe(ENTITY_KIND.autocannon);
    expect(BUILDING_KIND_BY_NAME.laserTower).toBe(ENTITY_KIND.laserTower);
    expect(BUILDING_KIND_BY_NAME.pulseTurret).toBe(ENTITY_KIND.laserTower);

    expect(isEconomyBuildingKind(ENTITY_KIND.roboticsFactory)).toBe(true);
    expect(isEconomyBuildingKind(ENTITY_KIND.droneControlArray)).toBe(true);
    expect(isEconomyBuildingKind(ENTITY_KIND.autocannon)).toBe(true);
    expect(isEconomyBuildingKind(ENTITY_KIND.laserTower)).toBe(true);

    expect(entityFootprint(ENTITY_KIND.roboticsFactory)).toBe(3);
    expect(entityFootprint(ENTITY_KIND.droneControlArray)).toBe(1);
    expect(entityFootprint(ENTITY_KIND.autocannon)).toBe(1);
    expect(entityFootprint(ENTITY_KIND.laserTower)).toBe(1);

    expect(resolveBuildingRow('droneArray')?.entityKind).toBe(ENTITY_KIND.droneControlArray);
    expect(resolveBuildingRow('turret')?.entityKind).toBe(ENTITY_KIND.autocannon);
    expect(resolveBuildingRow('pulseTurret')?.entityKind).toBe(ENTITY_KIND.laserTower);
    expect(resolveEconomyBuildingRow('droneArray')?.id).toBe('droneControlArray');
    expect(resolveEconomyBuildingRow('turret')?.id).toBe('autocannon');
    expect(resolveEconomyBuildingRow('pulseTurret')?.id).toBe('laserTower');

    const s = planet('w07-recon-pwr');
    const [rIdle] = addUnits(s, ENTITY_KIND.recon, 1, ENTITY_STATE.idle);
    expect(calculateUnitDemand(s, 0)).toBe(1);
    s.entities.cols.state[rIdle] = ENTITY_STATE.moving;
    expect(calculateUnitDemand(s, 0)).toBe(2);
  });
});

describe('W07-11 Army supply & Drone Control Array integration', () => {
  it('active Drone Control Array adds +8 to supplyCap (10 -> 18); constructing or offline DCA adds 0', () => {
    const s = planet('w07-dca-cap');
    addHub(s);
    expect(computeColonySupply(s, 0).cap).toBe(10);

    addDca(s, 3, 0, ENTITY_STATE.active);
    addDca(s, 4, 0, ENTITY_STATE.constructing);
    addDca(s, 5, 0, ENTITY_STATE.offlineBrownout);

    const sup = computeColonySupply(s, 0);
    expect(sup.cap).toBe(18);
    expect(sup.sources).toEqual([
      { building: 'commandHub', label: 'Command Hub', count: 1, each: 10, total: 10 },
      { building: 'droneControlArray', label: 'Drone Control Array', count: 1, each: 8, total: 8 },
    ]);
  });

  it('recon uses 1 supply, and checkUnitSupply / enqueueQueueTask blocks new production at cap', () => {
    const s = planet('w07-recon-cap');
    addHub(s);
    addUnits(s, ENTITY_KIND.recon, 9);
    expect(computeColonySupply(s, 0)).toMatchObject({ used: 9, units: 9, cap: 10, available: 1 });
    expect(checkUnitSupply(s, 0, 'recon')).toMatchObject({ ok: true, unitSupply: 1 });

    addUnits(s, ENTITY_KIND.recon, 1);
    expect(computeColonySupply(s, 0)).toMatchObject({ used: 10, units: 10, cap: 10, available: 0 });
    expect(checkUnitSupply(s, 0, 'recon')).toMatchObject({ ok: false, code: 'supply_cap' });

    const qRes = enqueueQueueTask(s, { colonyIndex: 0, task: { kind: 'buildUnit', unit: 'recon' } });
    expect(qRes.ok).toBe(true);
    if (qRes.ok) {
      expect(qRes.entry).toMatchObject({ state: 'waiting', waitReason: 'supply', waitDetail: 'waiting: supply' });
    }
  });

  it('DCA offline due to brownout -> supplyCap drops by 8; existing units keep working (overCap: true); new production blocked', () => {
    const s = planet('w07-dca-brownout');
    addHub(s);
    const dcaRow = addDca(s, 2, 0, ENTITY_STATE.active);
    const reconRows = addUnits(s, ENTITY_KIND.recon, 12, ENTITY_STATE.working);

    const initialSupply = computeColonySupply(s, 0);
    expect(initialSupply).toMatchObject({ used: 12, units: 12, cap: 18, available: 6 });
    expect(initialSupply.overCap).toBeUndefined();
    expect(checkUnitSupply(s, 0, 'recon').ok).toBe(true);

    // Trigger brownout on the grid (Hub generates 8 E/s; Hub drain 5 + DCA drain 5 + 12 active Recons 24 = 34 E/s demand)
    s.colonies[0].powerSupplyOverride = 5;
    evaluateColonyPower(s, 0, undefined, 1, 1);
    expect(s.entities.cols.state[dcaRow]).toBe(ENTITY_STATE.offlineBrownout);

    const p = pipeline();
    const stepRes = step(s, [enqueueCmd('blocked-recon', 'recon')], 1, p);

    // Supply cap dropped by 8 (18 -> 10), colony is overCap (12 / 10)
    const afterSupply = computeColonySupply(s, 0);
    expect(afterSupply).toMatchObject({
      used: 12,
      units: 12,
      cap: 10,
      available: 0,
      overCap: true,
    });
    expect(s.colonies[0].supply).toMatchObject({ used: 12, cap: 10, overCap: true });

    // Existing units remain alive and keep working
    for (const r of reconRows) {
      expect(s.entities.cols.hp[r]).toBe(160);
      expect(s.entities.cols.state[r]).toBe(ENTITY_STATE.working);
    }

    // New unit production is blocked both via command and via queue waiting state
    expect(stepRes.outcomes.find((o) => o.commandId === 'blocked-recon')).toMatchObject({
      code: 'supply_cap',
    });
    expect(checkUnitSupply(s, 0, 'recon')).toMatchObject({ ok: false, code: 'supply_cap' });

    const qRes = enqueueQueueTask(s, { colonyIndex: 0, taskId: 'wait-recon', task: { kind: 'buildUnit', unit: 'recon' } });
    expect(qRes.ok).toBe(true);
    expect(getColonyQueue(s, 0, 'units')[0]).toMatchObject({
      taskId: 'wait-recon',
      state: 'waiting',
      waitReason: 'supply',
      waitDetail: 'waiting: supply',
    });
  });
});
