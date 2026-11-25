import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  hexDistance,
  insertRow,
  placeSpawnedEntity,
  PREP,
  rowOf,
  SimHost,
  TERRAIN,
  type PlanetState,
  type SimEvent,
} from '../../src';

function makeReconHost(seed = 'recon-move-fire', radius = 20) {
  const pipeline = createRegistryPipeline({ flags: parseWaves('..07') });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-recon-maf', planetType: 'temperate', seed, radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  ensureColonyLedger(ensureColonyRecord(state, 0, 0)).status = 'active';
  ensureColonyLedger(ensureColonyRecord(state, 1, 0)).status = 'active';
  host.load(state);
  return { host, state };
}

function spawn(
  state: PlanetState,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number; footprint?: number },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.hp[row] = opts.hp ?? 160;
  cols.hpMax[row] = opts.hp ?? 160;
  cols.state[row] = ENTITY_STATE.idle;
  if (opts.footprint) {
    cols.footprintW[row] = opts.footprint;
    cols.footprintD[row] = opts.footprint;
  }
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return { id, row };
}

describe('Recon Scout moveUnit drive-by fire', () => {
  it('drives continuously to a manual moveUnit target past a flank enemy while firing and keeping chassis forward', () => {
    const { host, state } = makeReconHost('recon-maf-moveunit', 24);
    const recon = spawn(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 160 });
    const depot = spawn(state, { kind: ENTITY_KIND.supplyDepot, owner: 1, q: 5, r: 2, hp: 900, footprint: 2 });

    const events: SimEvent[] = [];
    host.onEvents((evs) => events.push(...evs));
    host.submit({
      commandId: 'mv-driveby',
      colonyIndex: 0,
      source: 'player',
      kind: 'moveUnit',
      args: { entityId: recon.id, q: 15, r: 0 },
    });

    const cols = state.entities.cols;
    let prevX = cols.x[recon.row]!;
    let rotatedTowardFlank = false;
    let hadTargetInRange = false;

    for (let tick = 1; tick <= 28; tick++) {
      host.step(1);
      const x = cols.x[recon.row]!;
      const q = cols.q[recon.row]!;
      const r = cols.r[recon.row]!;
      if (q < 15) expect(x).toBeGreaterThanOrEqual(prevX);
      prevX = x;
      if (Math.abs(cols.rot[recon.row]!) > 0.25) rotatedTowardFlank = true;
      const tgt = (state.blobs.battle?.value as { byEntityId?: Record<number, { targetId: number | null }> } | undefined)
        ?.byEntityId?.[recon.id]?.targetId;
      if (tgt === depot.id) hadTargetInRange = true;
      if (q === 15 && r === 0) break;
    }

    expect(cols.q[recon.row]).toBe(15);
    expect(cols.r[recon.row]).toBe(0);
    expect(rotatedTowardFlank).toBe(false);
    expect(hadTargetInRange).toBe(true);
    expect(events.some((e) => e.kind === 'projectileFired' && e.data?.attackerId === recon.id)).toBe(true);
    expect(cols.hp[rowOf(state.entities, depot.id)]!).toBeLessThan(900);

    // Out of weapon range & defend leash at (15, 0): battle targetId clears smoothly back to null.
    host.step(1);
    const tgtAtEnd = (state.blobs.battle?.value as { byEntityId?: Record<number, { targetId: number | null }> } | undefined)
      ?.byEntityId?.[recon.id]?.targetId;
    expect(tgtAtEnd).toBeNull();
  });
});

describe('Recon Scout attackMove drive-through fire', () => {
  it('never stops before an attackMove destination when engaging a high-HP flank target en route', () => {
    const { host, state } = makeReconHost('recon-maf-atkmove');
    const recon = spawn(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 160 });
    const depot = spawn(state, { kind: ENTITY_KIND.supplyDepot, owner: 1, q: 5, r: 2, hp: 900, footprint: 2 });

    const fired: SimEvent[] = [];
    host.onEvents((evs) => fired.push(...evs));
    host.submit({
      commandId: 'am-driveby',
      colonyIndex: 0,
      source: 'player',
      kind: 'attackMove',
      args: { entityIds: [recon.id], q: 10, r: 0 },
    });

    const cols = state.entities.cols;
    let prevX = cols.x[recon.row]!;
    for (let tick = 1; tick <= 18; tick++) {
      host.step(1);
      const x = cols.x[recon.row]!;
      if (cols.q[recon.row]! < 10) expect(x).toBeGreaterThan(prevX - 1e-4);
      prevX = x;
      if (cols.q[recon.row] === 10 && cols.r[recon.row] === 0) break;
    }

    expect(cols.q[recon.row]).toBe(10);
    expect(cols.r[recon.row]).toBe(0);
    expect(fired.some((e) => e.kind === 'projectileFired' && e.data?.attackerId === recon.id)).toBe(true);
    expect(cols.hp[rowOf(state.entities, depot.id)]!).toBeLessThan(900);
  });
});

describe('Recon Scout moving-target pursuit while firing', () => {
  it('continues moving while firing when chasing a moving target via attackTarget', () => {
    const { host, state } = makeReconHost('recon-maf-chase');
    const recon = spawn(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 160 });
    const fleeing = spawn(state, { kind: ENTITY_KIND.worker, owner: 1, q: 4, r: 0, hp: 800 });

    const fired: SimEvent[] = [];
    host.onEvents((evs) => fired.push(...evs));

    host.submit({
      commandId: 'worker-flee',
      colonyIndex: 1,
      source: 'player',
      kind: 'moveUnit',
      args: { entityId: fleeing.id, q: 14, r: 0 },
    });
    host.submit({
      commandId: 'recon-chase',
      colonyIndex: 0,
      source: 'player',
      kind: 'attackTarget',
      args: { entityIds: [recon.id], targetId: fleeing.id },
    });

    const cols = state.entities.cols;
    const startX = cols.x[recon.row]!;
    for (let tick = 1; tick <= 12; tick++) {
      host.step(1);
    }

    expect(cols.x[recon.row]!).toBeGreaterThan(startX + 2.5);
    expect(fired.some((e) => e.kind === 'projectileFired' && e.data?.attackerId === recon.id)).toBe(true);
    const fRow = rowOf(state.entities, fleeing.id);
    expect(cols.hp[fRow]!).toBeLessThan(800);
    expect(hexDistance(cols.x[recon.row]!, cols.y[recon.row]!, cols.x[fRow]!, cols.y[fRow]!)).toBeLessThanOrEqual(4.5);
  });
});
