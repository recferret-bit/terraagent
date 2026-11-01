import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  decodeDiff,
  DEPOSIT,
  diffSince,
  hexIndex,
  restore,
  revealSubsurface,
  SimHost,
  snapshot,
  spawnHqUnit,
  TERRAIN,
  tileLayers,
  touchTile,
  type SimCommand,
} from '../../src';

const hiddenNames = () => tileLayers().filter((l) => l.hidden).map((l) => l.name);
const firstBuried = (s: ReturnType<typeof createPlanet>, terrain?: number) => {
  for (let i = 0; i < s.grid.count; i++) if (s.grid.layers.subDeposit[i] && (terrain === undefined || s.grid.layers.terrain[i] === terrain)) return i;
  return -1;
};

describe('hidden subsurface never reaches a client (D-38)', () => {
  it('client snapshots omit hidden layers (restore zero-fills), persisted snapshots keep them', () => {
    const s = createPlanet({ id: 'p', seed: 'hidden-1', type: 'temperate', planetType: 'desert', radius: 56 });
    expect(hiddenNames()).toEqual(['subDeposit', 'subRichness']);
    const i = firstBuried(s);
    expect(i).toBeGreaterThanOrEqual(0);
    const client = restore(snapshot(s, { forClient: true }));
    const saved = restore(snapshot(s));
    for (const n of hiddenNames()) {
      expect(Array.from(client.grid.layers[n]).every((v) => v === 0)).toBe(true);
      expect(Array.from(saved.grid.layers[n])).toEqual(Array.from(s.grid.layers[n]));
    }
    expect(Array.from(client.grid.layers.deposit)).toEqual(Array.from(s.grid.layers.deposit));
  });

  it('client diffs carry the changed tile without its hidden layers; server diffs keep them', () => {
    const s = createPlanet({ id: 'p', seed: 'hidden-2', type: 'temperate', planetType: 'desert', radius: 56 });
    const i = firstBuried(s);
    s.meta.tick = 5;
    touchTile(s, i, 5);
    const c = decodeDiff(diffSince(s, 4, { forClient: true }));
    const full = decodeDiff(diffSince(s, 4));
    expect(Array.from(c.tiles.idx)).toEqual([i]);
    for (const n of hiddenNames()) {
      expect(c.tiles.cols[n]).toBeUndefined();
      expect(full.tiles.cols[n]).toBeDefined();
    }
  });

  it('revealSubsurface moves the buried deposit into the public layers once', () => {
    const s = createPlanet({ id: 'p', seed: 'hidden-3', type: 'temperate', planetType: 'desert', radius: 56 });
    const i = firstBuried(s);
    const kind = s.grid.layers.subDeposit[i];
    const rich = Math.round(s.grid.layers.subRichness[i]);
    expect(s.grid.layers.deposit[i]).toBe(DEPOSIT.none);
    expect(revealSubsurface(s, i, 3)).toEqual({ deposit: ['none', 'metals', 'minerals', 'oil'][kind], richnessBp: rich });
    expect([s.grid.layers.deposit[i], s.grid.layers.richness[i], s.grid.layers.subDeposit[i]]).toEqual([kind, rich, 0]);
    expect(s.grid.layers.changedAt[i]).toBe(3);
    expect(revealSubsurface(s, i, 4)).toBeNull();
  });

  it('real loop: Break on buried rock via enqueueTask reveals the deposit and emits groundRevealed', () => {
    const host = new SimHost({ flags: parseWaves('..01') });
    host.load(createPlanet({ id: 'p', seed: 'hidden-4', type: 'temperate', planetType: 'desert', radius: 56 }));
    const s = host.state;
    const i = firstBuried(s, TERRAIN.rock);
    expect(i).toBeGreaterThanOrEqual(0);
    const hx = hexIndex(s.grid.radius);
    const tq = hx.q[i], tr = hx.r[i];
    spawnHqUnit(s, { owner: 0, q: tq + 1, r: tr });
    const cmd: SimCommand = { colonyIndex: 0, source: 'player', commandId: 'hb', kind: 'enqueueTask', args: { terraform: { op: 'break', tiles: [{ q: tq, r: tr }] } } };
    host.submit(cmd);
    const events: string[] = [];
    for (let t = 0; t < 600 && s.grid.layers.terrain[i] !== TERRAIN.flat; t++) events.push(...host.step(1).events.map((e) => e.kind));
    expect(s.grid.layers.terrain[i]).toBe(TERRAIN.flat);
    expect(s.grid.layers.deposit[i]).not.toBe(DEPOSIT.none);
    expect(events).toContain('groundRevealed');
  });
});
