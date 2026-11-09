import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ensureColonyLedger,
  flattenDuneFootprint,
  hexIndex,
  PREP,
  revealAroundChanged,
  revealSubsurface,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  spawnTerraformDeposit,
  step,
  TERRAIN,
  type PlanetState,
  type SimCommand,
  type SimEvent,
  type StepContext,
  type WorkJobRecord,
} from '../../src';

/** A level wild Flat world (nothing buried, unclaimed) with colony 0 and its HQ at (0, 0). */
function flatWorld(seed: string, radius = 10) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius });
  state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
  const L = state.grid.layers;
  for (let k = 0; k < state.grid.count; k++) {
    setTileTerrain(state, k, TERRAIN.flat, 0);
    setTilePrep(state.grid, k, PREP.wild, 0);
    L.height[k] = 0;
    L.subDeposit[k] = 0;
    L.owner[k] = -1;
  }
  const hx = hexIndex(radius);
  const at = (q: number, r: number) => hx.indexOf(q, r);
  const bury = (q: number, r: number, kind: number = DEPOSIT.metals) => {
    L.subDeposit[at(q, r)] = kind;
    L.subRichness[at(q, r)] = 12000;
  };
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
  const events: SimEvent[] = [];
  const run = (cmds: SimCommand[] = []) => events.push(...step(state, cmds, 1, pipeline).events);
  return { state, L, hx, at, bury, run, events };
}

const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const;
const work = (id: string, tiles: Array<{ q: number; r: number }>): SimCommand => ({
  commandId: id, colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles } },
});
const noJobs = (s: PlanetState) => Object.keys((s.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {}).length === 0;
function runUntilIdle(w: ReturnType<typeof flatWorld>): void {
  for (let t = 0; t < 6000 && !noJobs(w.state); t++) w.run();
  expect(noJobs(w.state)).toBe(true);
}
const revealedAt = (events: SimEvent[]) =>
  events.filter((e) => e.kind === 'groundRevealed').map((e) => [(e.data as { q: number }).q, (e.data as { r: number }).r]);

describe('buried deposits only appear on hex tiles (runtime reveal)', () => {
  it('a buried rock ringed by rock: breaking it reveals nothing; breaking its last neighbour reveals it (real work loop)', () => {
    const w = flatWorld('hex-reveal-ring');
    const c = { q: 4, r: 0 }, ci = w.at(c.q, c.r);
    const ring = RING.map(([dq, dr]) => w.at(c.q + dq, c.r + dr));
    for (const i of [ci, ...ring]) w.L.terrain[i] = TERRAIN.rock;
    w.bury(c.q, c.r);
    w.run([work('centre', [c])]); // the order chains on through the rock around it
    for (let t = 0; t < 6000 && w.L.terrain[ci] !== TERRAIN.flat; t++) w.run();
    expect(w.L.terrain[ci]).toBe(TERRAIN.flat);
    expect(ring.some((i) => w.L.terrain[i] === TERRAIN.rock)).toBe(true);
    expect(w.L.deposit[ci]).toBe(DEPOSIT.none); // cleared, but its hexagon still touches rock
    expect(w.L.subDeposit[ci]).toBe(DEPOSIT.metals);
    runUntilIdle(w);
    expect(ring.every((i) => w.L.terrain[i] === TERRAIN.flat)).toBe(true);
    expect([w.L.deposit[ci], w.L.subDeposit[ci]]).toEqual([DEPOSIT.metals, DEPOSIT.none]);
    expect(revealedAt(w.events)).toEqual([[c.q, c.r]]); // reported at the revealed tile, not at the worked one
    // revealed by the job that broke the LAST rock beside it: five ring rocks went before, the sixth right after
    const kinds = w.events.filter((e) => e.kind === 'groundRevealed' || e.kind === 'obstacleRemoved');
    const at = kinds.findIndex((e) => e.kind === 'groundRevealed');
    const isRing = (e: SimEvent) => ring.includes(w.at((e.data as { q: number }).q, (e.data as { r: number }).r));
    expect(kinds.slice(0, at).filter(isRing)).toHaveLength(5);
    expect(isRing(kinds[at + 1]!)).toBe(true);
  });

  it('revealSubsurface refuses wild ground; revealAroundChanged tries the changed tiles and their neighbours once', () => {
    const w = flatWorld('hex-reveal-direct');
    const i = w.at(2, 2);
    w.bury(2, 2, DEPOSIT.oil);
    w.L.terrain[w.at(3, 2)] = TERRAIN.forest;
    expect(revealSubsurface(w.state, i, 1)).toBeNull();
    expect(revealAroundChanged(w.state, [w.at(3, 2)], 1)).toEqual([]);
    w.L.terrain[w.at(3, 2)] = TERRAIN.flat; // the tree is gone
    expect(revealAroundChanged(w.state, [w.at(3, 2), w.at(3, 1)], 2)).toEqual([{ q: 2, r: 2, deposit: 'oil', richnessBp: 12000 }]);
    expect(w.L.deposit[i]).toBe(DEPOSIT.oil);
    expect(revealAroundChanged(w.state, [w.at(3, 2)], 3)).toEqual([]);
  });

  it('a flattened dune disc reveals its inside, not its rim beside the remaining dune; the next disc reveals the rim', () => {
    const w = flatWorld('hex-reveal-dune', 12);
    for (let k = 0; k < w.state.grid.count; k++) {
      if (w.hx.q[k] >= 2) { w.L.terrain[k] = TERRAIN.slope; w.L.height[k] = 1.2; }
    }
    const inner = { q: 5, r: 0 }, rim = { q: 7, r: 0 };
    w.bury(inner.q, inner.r, DEPOSIT.minerals);
    w.bury(rim.q, rim.r, DEPOSIT.oil);
    const first = flattenDuneFootprint(w.state, 5, 0, 1);
    expect(first.count).toBe(19);
    expect(first.revealed).toEqual([{ q: 5, r: 0, deposit: 'minerals', richnessBp: 12000 }]);
    expect(w.L.deposit[w.at(rim.q, rim.r)]).toBe(DEPOSIT.none); // rim: open and level, but beside the remaining dune
    const second = flattenDuneFootprint(w.state, 9, 0, 2);
    expect(second.revealed).toContainEqual({ q: 7, r: 0, deposit: 'oil', richnessBp: 12000 });
    expect(w.L.deposit[w.at(rim.q, rim.r)]).toBe(DEPOSIT.oil);
  });
});

describe('terraform finds only land on hex tiles', () => {
  const ctx = (events: unknown[] = []) => ({ tick: 3, emit: (e: unknown) => events.push(e) }) as unknown as StepContext;

  it('a worked tile beside rock rolls nothing (no rng draw); on a hex tile the same roll spawns', () => {
    const w = flatWorld('hex-find');
    const wild = w.at(3, 0), open = w.at(-3, 0);
    w.L.terrain[w.at(4, 0)] = TERRAIN.rock;
    let draws = 0;
    const rand = () => { draws++; return 0; };
    expect(spawnTerraformDeposit(w.state, { tileIdx: wild, q: 3, r: 0 }, { colonyId: 'col-0' }, ctx(), rand)).toBeNull();
    expect(draws).toBe(0);
    expect(w.L.deposit[wild]).toBe(DEPOSIT.none);
    const events: unknown[] = [];
    expect(spawnTerraformDeposit(w.state, { tileIdx: open, q: -3, r: 0 }, { colonyId: 'col-0' }, ctx(events), rand)).not.toBeNull();
    expect(w.L.deposit[open]).not.toBe(DEPOSIT.none);
    expect(events).toHaveLength(1);
  });
});
