import 'reflect-metadata';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@terra/contracts';
import { compileData, parseOverrides, restore, type BalanceOverrides } from '@terra/sim';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBalanceOverrides } from '../../src/game/balance-overrides';
import { GamePlanets } from '../../src/game/game-planets.service';
import { SimThreadPool } from '../../src/game/sim-thread-pool';

const FLAGS = ['W00'];
const BASE_HASH = compileData(new Set(FLAGS)).hash;
let games: GamePlanets | undefined;
afterEach(async () => { await games?.shutdown(); games = undefined; });

async function boot(overrides?: BalanceOverrides) {
  const pool = new SimThreadPool({ threads: 1, flags: FLAGS, ...(overrides ? { overrides } : {}) });
  await pool.start();
  return (games = new GamePlanets(pool));
}
const cmd = (kind: string, args: Record<string, unknown>) => ({ colonyIndex: null, source: 'dev' as const, commandId: Math.random().toString(36).slice(2), kind, args });

/** Spawns a probe at (0,0), nudges it once along +q and returns how far it moved. */
async function nudgeDistance(g: GamePlanets, id: string): Promise<number> {
  expect((await g.submit(id, cmd('dev.spawn', { q: 0, r: 0 }))).ok).toBe(true);
  const ents = restore((await g.fullState(id)).bytes).entities;
  const eid = ents.cols.id[ents.count - 1]!;
  expect((await g.submit(id, cmd('dev.nudge', { id: eid }))).ok).toBe(true);
  const after = restore((await g.fullState(id)).bytes).entities;
  return after.cols.x[after.cols.id.indexOf(eid)]!;
}

describe('tune (balance overrides, D-35)', () => {
  it('a live tune applies to the next command, changes the hash, records dev.tuned; reset restores the exact hash', async () => {
    const g = await boot();
    const id = newId('pl');
    await g.load(id);
    const events: { kind: string; data: Record<string, unknown> }[] = [];
    g.onEvents((_p, ev) => ev.forEach((e) => events.push(e)));
    expect((await g.fullState(id)).dataHash).toBe(BASE_HASH);
    expect(await nudgeDistance(g, id)).toBe(1);

    const t = await g.tune(id, { op: 'set', path: 'dev.probe.nudgeTiles', value: '3' });
    expect(t).toMatchObject({ ok: true, overrides: { dev: { probe: { nudgeTiles: 3 } } } });
    expect(t.dataHash).not.toBe(BASE_HASH);
    const full = await g.fullState(id);
    expect(full.dataHash).toBe(t.dataHash);
    expect(full.overrides).toEqual({ dev: { probe: { nudgeTiles: 3 } } });
    expect(await nudgeDistance(g, id)).toBe(3);
    await new Promise((r) => setTimeout(r, 50));
    expect(events.find((e) => e.kind === 'dev.tuned')?.data).toEqual({ op: 'set', path: 'dev.probe.nudgeTiles', value: 3, dataHash: t.dataHash });

    const exp = await g.tune(id, { op: 'export' });
    expect(parseOverrides(JSON.parse(exp.text as string))).toEqual({ dev: { probe: { nudgeTiles: 3 } } });
    expect(compileData(new Set(FLAGS), JSON.parse(exp.text as string)).hash).toBe(t.dataHash);

    const r = await g.tune(id, { op: 'reset' });
    expect(r.dataHash).toBe(BASE_HASH);
    expect((await g.fullState(id)).dataHash).toBe(BASE_HASH);
    expect((await g.fullState(id)).overrides).toEqual({});
    expect(await nudgeDistance(g, id)).toBe(1);
  });

  it('a bad path or value is rejected and leaves the planet untouched', async () => {
    const g = await boot();
    const id = newId('pl');
    await g.load(id);
    for (const [path, value] of [['dev.probe.nope', '1'], ['dev.nope.nudgeTiles', '1'], ['nope.probe.nudgeTiles', '1'], ['dev.probe', '1'], ['dev.probe.nudgeTiles', 'abc']] as const) {
      const r = await g.tune(id, { op: 'set', path, value });
      expect(r.ok, path).toBe(false);
      expect(r.error).toBeTruthy();
      expect(r.dataHash).toBe(BASE_HASH);
    }
  });

  it('file overrides apply at boot, scenario overrides layer on top, live tunes on top of both; reset returns to file + scenario', async () => {
    const g = await boot({ dev: { probe: { nudgeTiles: 2, buildS: 60 } } });
    const a = newId('pl'), b = newId('pl');
    await g.load(a);
    await g.load(b, { overrides: { dev: { probe: { nudgeTiles: 5 } } } });
    const fileHash = (await g.fullState(a)).dataHash;
    expect(fileHash).toBe(compileData(new Set(FLAGS), { dev: { probe: { nudgeTiles: 2, buildS: 60 } } }).hash);
    expect(await nudgeDistance(g, a)).toBe(2);
    expect(await nudgeDistance(g, b)).toBe(5);
    expect((await g.fullState(b)).overrides).toEqual({ dev: { probe: { nudgeTiles: 5, buildS: 60 } } });
    await g.tune(b, { op: 'set', path: 'dev.probe.ratePerS', value: '4' });
    expect((await g.fullState(a)).dataHash).toBe(fileHash); // planets are independent
    const r = await g.tune(b, { op: 'reset' });
    expect(r.overrides).toEqual({ dev: { probe: { nudgeTiles: 5, buildS: 60 } } });
  });

  it('a scenario with a bad override fails the load', async () => {
    const g = await boot();
    await expect(g.load(newId('pl'), { overrides: { dev: { probe: { typo: 1 } } } })).rejects.toThrow(/unknown field "dev.probe.typo"/);
  });
});

describe('TA_BALANCE_OVERRIDES file', () => {
  const write = (text: string) => {
    const f = join(mkdtempSync(join(tmpdir(), 'bal-')), 'balance.overrides.json');
    writeFileSync(f, text);
    return f;
  };
  it('unset = none; a valid file is returned', () => {
    expect(loadBalanceOverrides(undefined, FLAGS)).toEqual({});
    expect(loadBalanceOverrides(write('{"dev":{"probe":{"nudgeTiles":4}}}'), FLAGS)).toEqual({ dev: { probe: { nudgeTiles: 4 } } });
  });
  it('a missing, malformed or unknown-field file is a boot error naming the file', () => {
    const bad = write('{not json');
    expect(() => loadBalanceOverrides(bad, FLAGS)).toThrow(new RegExp(`TA_BALANCE_OVERRIDES ${bad.replace(/[.\\]/g, '\\$&')}`));
    expect(() => loadBalanceOverrides(write('{"dev":{"probe":{"typo":1}}}'), FLAGS)).toThrow(/unknown field/);
    expect(() => loadBalanceOverrides(write('[]'), FLAGS)).toThrow(/root must be an object/);
    expect(() => loadBalanceOverrides('/nonexistent/balance.json', FLAGS)).toThrow(/TA_BALANCE_OVERRIDES \/nonexistent/);
  });
});
