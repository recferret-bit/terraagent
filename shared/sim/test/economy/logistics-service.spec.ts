import { RESOURCE_KEYS, parseWaves, type ResourceKey } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  RESIDUAL_SCALE, applyEnvironmentState, compileData, createRegistryPipeline, createState, creditResource, decodeValue, encodeValue, ensureColonyLedger,
  ENTITY_KIND, ENTITY_STATE, environmentFromPlanetTime, getColonyStock, getLogisticsView, deliveredServiceBp, insertRow, restore, setPlanetTime, snapshot, step,
  type LedgerPosting, type PlanetState, type SimCommand,
} from '../../src';

/** W13-53: logistics supply windows against hand-priced rows (window 60 s = 300 ticks; extractor weight 20, recipe 2 water). */
const WINDOW = 300;

function setup(waves: string, stock: Partial<Record<ResourceKey, number>>, extractors = 1) {
  const flags = parseWaves(waves);
  const data = compileData(flags);
  const state = createState({ planetId: 'p-w13-53', planetType: 'temperate', seed: 'w13-53', radius: 12 });
  setPlanetTime(state, { timeOfDay: 12, timeScale: 0 }, 0, data);
  applyEnvironmentState(state, environmentFromPlanetTime(state, data, false, 0), 0);
  state.colonies[0] = { index: 0, id: 'col_0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 };
  const col = ensureColonyLedger(state.colonies[0]);
  for (const [k, v] of Object.entries(stock)) creditResource(col, k as ResourceKey, v, 0);
  const rows: Record<string, number> = {};
  const put = (name: string, kind: number, q: number, r: number, w: number, hp: number): void => {
    const cols = state.entities.cols;
    const id = state.meta.nextEntityId++;
    const row = insertRow(state.entities, id, 0);
    cols.kind[row] = kind; cols.owner[row] = 0; cols.tier[row] = 1; cols.q[row] = q; cols.r[row] = r;
    cols.footprintW[row] = w; cols.footprintD[row] = w; cols.shedGroup[row] = 4; cols.hp[row] = hp; cols.hpMax[row] = hp;
    cols.state[row] = ENTITY_STATE.active;
    rows[name] = id;
  };
  put('hub', ENTITY_KIND.commandHub, 0, 0, 3, 1500);
  put('depot', ENTITY_KIND.supplyDepot, 4, 0, 2, 600);
  for (let i = 0; i < 3; i++) put(`solar${i}`, ENTITY_KIND.solar, 3 + i * 3, -4, 2, 400);
  for (let i = 0; i < extractors; i++) put(`ext${i}`, ENTITY_KIND.metalsExtractor, -4, 2 + i * 3, 2, 300);
  const pipeline = createRegistryPipeline({ flags, data });
  const postings: LedgerPosting[] = [];
  const run = (n = 1, cmds: SimCommand[] = []): void => {
    for (let i = 0; i < n; i++) postings.push(...step(state, i === 0 ? cmds : [], 1, pipeline).postings);
  };
  /** Destroys a building (hp 0), like a depot or generator lost in combat. */
  const destroy = (name: string): void => {
    const row = state.entities.cols.id.findIndex((v, i) => i < state.entities.count && v === rows[name]);
    state.entities.cols.hp[row] = 0;
  };
  return { state, run, postings, rows, destroy, pipeline };
}

const stock = (s: PlanetState, k: ResourceKey = 'bio.water'): number => getColonyStock(s, 0)[k];
const logi = (ps: LedgerPosting[], r: string): LedgerPosting[] => ps.filter((p) => p.reason === r);
const net = (ps: LedgerPosting[], key: string): number => ps.flatMap((p) => p.legs).filter((l) => l.account === 'colony:0' && l.asset === key).reduce((a, l) => a + l.delta, 0);

describe('W13-53 logistics service windows', () => {
  it('bills the priced recipe once per window, keeps the local reserve and posts only whole units', () => {
    const t = setup('..13', { 'bio.water': 100 });
    t.run(2);
    const v = getLogisticsView(t.state, 0);
    const id = String(t.rows.ext0);
    expect(v.summary).toMatchObject({ K: 160, M: '1/1' });
    expect(v.entities[id]).toMatchObject({ status: 'supplied', ratioBp: 10000 });
    // 2 water at full activity, route factor from the real path, reserve top-up of one more window
    const need = v.entities[id]!.need['bio.water']!;
    expect(need).toBeGreaterThanOrEqual(2 * RESIDUAL_SCALE);
    t.run(WINDOW);
    const consumed = -net(t.postings, 'bio.water');
    expect(consumed).toBeGreaterThan(0);
    for (const p of t.postings) for (const l of p.legs) expect(Number.isInteger(l.delta)).toBe(true);
    for (const k of RESOURCE_KEYS) expect(Number.isInteger(stock(t.state, k))).toBe(true);
    expect(logi(t.postings, 'logistics.supply').length).toBeGreaterThan(0);
  });

  it('partial service: after reserve and grace are gone only the delivered share runs', () => {
    const t = setup('..13', { 'bio.water': 1 }, 1);
    t.run(2);
    const id = String(t.rows.ext0);
    expect(getLogisticsView(t.state, 0).entities[id]!.status).toBe('grace');
    expect(deliveredServiceBp(t.state, 0, t.rows.ext0!)).toBe(10000);
    t.run(WINDOW * 4);
    expect(getLogisticsView(t.state, 0).entities[id]!.ratioBp).toBe(0);
    creditResource(ensureColonyLedger(t.state.colonies[0]!), 'bio.water', 1, t.state.meta.tick);
    t.run(WINDOW);
    const e = getLogisticsView(t.state, 0).entities[id]!;
    expect(e.status).toBe('partial');
    expect(e.ratioBp).toBeGreaterThan(4000);
    expect(e.ratioBp).toBeLessThan(6000);
    expect(deliveredServiceBp(t.state, 0, t.rows.ext0!)).toBe(e.ratioBp);
  });

  it('allocates scarce inputs by priority then entity id (the lower id gets the stock)', () => {
    const t = setup('..13', { 'bio.water': 2 }, 2);
    t.run(2);
    const w = (t.state.blobs.logistics!.value as { colonies: Record<string, { window: { entities: Record<string, { held: Record<string, number> }> } }> }).colonies['0']!.window.entities;
    expect(w[String(t.rows.ext0)]!.held['bio.water']).toBe(2_000_000);
    expect(w[String(t.rows.ext1)]!.held['bio.water']).toBeUndefined();
  });

  it('depot and hub loss: the node stops counting, the window is replanned and the undelivered part is released', () => {
    const t = setup('..13', { 'bio.water': 100 });
    t.run(WINDOW + 2);
    const before = getLogisticsView(t.state, 0).summary!.K;
    expect(before).toBe(160);
    const releases = logi(t.postings, 'logistics.release').length;
    t.destroy('depot');
    t.run(2);
    const v = getLogisticsView(t.state, 0);
    expect(v.summary!.K).toBe(100);
    expect(logi(t.postings, 'logistics.release').length).toBeGreaterThan(releases);
    t.destroy('hub');
    t.run(3);
    expect(getLogisticsView(t.state, 0).entities[String(t.rows.ext0)]!.unavailable).toBe('no_supply_node');
  });

  it('snapshot/restore mid-window continues identically and a replayed window does not recharge', () => {
    const a = setup('..13', { 'bio.water': 100 });
    a.run(WINDOW / 2);
    const snap = decodeValue(encodeValue(snapshot(a.state))) as ReturnType<typeof snapshot>;
    const b = setup('..13', {});
    const restored = restore(snap);
    a.run(WINDOW * 2);
    const pb: LedgerPosting[] = [];
    for (let i = 0; i < WINDOW * 2; i++) pb.push(...step(restored, [], 1, b.pipeline).postings);
    expect(JSON.stringify(restored.blobs.logistics)).toBe(JSON.stringify(a.state.blobs.logistics));
    expect(getColonyStock(restored, 0)).toEqual(getColonyStock(a.state, 0));
    // the same pinned window is never planned twice: one reservation per window
    const keys = new Set(pb.filter((p) => p.reason === 'logistics.supply').map((p) => p.at));
    expect(keys.size).toBe(pb.filter((p) => p.reason === 'logistics.supply').length);
  });

  it('W13 off: no logistics state, no postings, production unchanged', () => {
    const t = setup('..12', { 'bio.water': 100 });
    t.run(WINDOW * 2);
    expect(t.state.blobs.logistics).toBeUndefined();
    expect(t.postings.filter((p) => p.reason.startsWith('logistics.'))).toEqual([]);
    expect(deliveredServiceBp(t.state, 0, t.rows.ext0!)).toBe(10000);
  });
});
