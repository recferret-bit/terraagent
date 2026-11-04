import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ENTITY_STATE,
  ensureColonyLedger,
  enqueueTerraformOrder,
  getColonyTerraformOrders,
  hexIndex,
  PREP,
  rowOf,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  step,
  TERRAIN,
  type PlanetState,
  type SimCommand,
  type WorkJobRecord,
} from '../../src';
import { UnitBook } from '../../src/units/book';

/** A level wild Flat world with colony 0 and its HQ at (0, 0). */
function flatWorld(seed: string) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 10 });
  state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
  const L = state.grid.layers;
  for (let k = 0; k < state.grid.count; k++) {
    setTileTerrain(state, k, TERRAIN.flat, 0);
    setTilePrep(state.grid, k, PREP.wild, 0);
    setTileDeposit(state, k, DEPOSIT.none, 0, 0);
    L.height[k] = 0;
    L.subDeposit[k] = 0;
    L.owner[k] = -1;
  }
  const hx = hexIndex(10);
  const hq = spawnHqUnit(state, { owner: 0, q: 0, r: 0 }) as number;
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
  const run = (cmds: SimCommand[] = [], n = 1) => step(state, cmds, n, pipeline);
  return { state, hq, run, at: (q: number, r: number) => hx.indexOf(q, r) };
}

const cmd = (commandId: string, kind: string, args: unknown): SimCommand => ({ commandId, colonyIndex: 0, source: 'player', kind, args });
const work = (id: string, q: number, r: number) => cmd(id, 'enqueueTask', { terraform: { op: 'work', tiles: [{ q, r }] } });
const jobsOf = (state: PlanetState) => (state.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {};
const tfTiles = [{ q: 3, r: 0 }, { q: -3, r: 0 }, { q: 0, r: 3 }];

describe('cancelTask scope sameKind (one cancel click ends every order of the kind)', () => {
  it('several work orders queued for one worker: one cancel ends them all and the worker idles', () => {
    const w = flatWorld('csk-1');
    for (const [i, t] of tfTiles.entries()) {
      w.state.grid.layers.terrain[w.at(t.q, t.r)] = TERRAIN.forest;
      expect(w.run([work(`w${i}`, t.q, t.r)]).outcomes[0].code).toBeUndefined();
    }
    w.run([], 5);
    expect(Object.keys(jobsOf(w.state))).toHaveLength(3);
    const res = w.run([cmd('c', 'cancelTask', { taskId: 'w2', scope: 'sameKind' })]);
    expect(res.outcomes[0].code).toBeUndefined();
    expect(Object.keys(jobsOf(w.state))).toHaveLength(0);
    expect(w.state.entities.cols.state[rowOf(w.state.entities, w.hq)]).toBe(ENTITY_STATE.idle);
    const rec = new UnitBook(w.state).get(w.hq);
    expect(rec.current?.kind === 'terraform' ? rec.current : null).toBeNull();
    w.run([], 30); // nothing is handed back to the worker
    expect(Object.keys(jobsOf(w.state))).toHaveLength(0);
  });

  it('default scope (one) cancels just that order', () => {
    const w = flatWorld('csk-2');
    for (const [i, t] of tfTiles.entries()) {
      w.state.grid.layers.terrain[w.at(t.q, t.r)] = TERRAIN.forest;
      w.run([work(`w${i}`, t.q, t.r)]);
    }
    expect(w.run([cmd('c', 'cancelTask', { taskId: 'w1' })]).outcomes[0].code).toBeUndefined();
    expect(Object.keys(jobsOf(w.state)).sort()).toEqual(['w0', 'w2']);
  });

  it('terraform orders in the colony queue: one cancel clears them all and leaves no target hexes', () => {
    const w = flatWorld('csk-3');
    w.state.grid.layers.owner.fill(0);
    for (const t of tfTiles) {
      const r = enqueueTerraformOrder(w.state, { colonyId: 0, op: 'grade', tiles: [t] });
      expect(r.ok).toBe(true);
    }
    const first = getColonyTerraformOrders(w.state, 0);
    expect(first).toHaveLength(3);
    const res = w.run([cmd('c', 'cancelTask', { taskId: first[0]!.orderId, scope: 'sameKind' })]);
    expect(res.outcomes[0].code).toBeUndefined();
    expect(getColonyTerraformOrders(w.state, 0)).toHaveLength(0);
    expect(Object.keys(jobsOf(w.state))).toHaveLength(0);
  });

  it('an unknown id is still rejected; an invalid scope is invalid_args', () => {
    const w = flatWorld('csk-4');
    expect(w.run([cmd('c1', 'cancelTask', { taskId: 'nope', scope: 'sameKind' })]).outcomes[0].code).toBeDefined();
    expect(w.run([cmd('c2', 'cancelTask', { taskId: 'x', scope: 'bogus' })]).outcomes[0].code).toBe('invalid_args');
  });
});
