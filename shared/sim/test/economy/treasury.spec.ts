import { describe, expect, it } from 'vitest';
import {
  ColonyTreasury,
  DEV_ACTOR,
  colonyActor,
  findShortfall,
  getColonyStock,
  setColonyStock,
  systemActor,
  treasury,
  treasuryCtx,
  unrecorded,
  type LedgerPosting,
  type LedgerReason,
} from '../../src';
import { collector, emptyPlanet, fullStock } from './helpers';

const admin = systemActor('admin');

describe('treasury ctx', () => {
  it('treasuryCtx records into the step ctx when it has a record, else discards', () => {
    const into: LedgerPosting[] = [];
    const withStep = treasuryCtx(5, { record: (p) => void into.push(p) });
    expect(withStep.tick).toBe(5);
    const bare = treasuryCtx(6);
    const empty = treasuryCtx(7, {});
    expect([bare.tick, empty.tick]).toEqual([6, 7]);

    const state = emptyPlanet();
    for (const ctx of [bare, empty, withStep]) {
      treasury(state, ctx).add({ colony: 0, amounts: { 'metals.t1': 1 }, reason: 'trade', actor: admin });
    }
    expect(getColonyStock(state, 0)['metals.t1']).toBe(3);
    expect(into).toHaveLength(1);
    expect(into[0].at).toBe(5);
  });

  it('unrecorded changes state but drops the posting, stamping its tick', () => {
    const state = emptyPlanet();
    const res = treasury(state, unrecorded(9)).add({ colony: 0, amounts: { 'bio.water': 4 }, reason: 'dev.grant', actor: DEV_ACTOR });
    expect(res.ok && res.posting?.at).toBe(9);
    expect(getColonyStock(state, 0)['bio.water']).toBe(4);
    expect(state.colonies[0].changedAt).toBe(9);
  });
});

describe('ColonyTreasury.add', () => {
  it('credits whole units and records exactly one posting: counter → colony legs, reason, actor, ref, at', () => {
    const state = emptyPlanet();
    const ctx = collector(7);
    const res = treasury(state, ctx).add({
      colony: 0,
      amounts: { 'metals.t1': 600, 'bio.water': 200 },
      reason: 'landing.cargo',
      actor: systemActor('landing'),
      ref: 'pod:1',
    });
    const posting = {
      at: 7,
      reason: 'landing.cargo',
      actor: 'system:landing',
      ref: 'pod:1',
      legs: [
        { account: 'sys:cargo', asset: 'bio.water', delta: -200 },
        { account: 'colony:0', asset: 'bio.water', delta: 200 },
        { account: 'sys:cargo', asset: 'metals.t1', delta: -600 },
        { account: 'colony:0', asset: 'metals.t1', delta: 600 },
      ],
    };
    expect(res).toEqual({ ok: true, credited: { 'metals.t1': 600, 'bio.water': 200 }, overflow: {}, posting });
    expect(ctx.postings).toEqual([posting]);
    expect(ctx.postings[0]).not.toHaveProperty('opId');
    expect(getColonyStock(state, 0)).toEqual(fullStock({ 'metals.t1': 600, 'bio.water': 200 }));
  });

  it('writes col.stock and col.resources, creating the colony record when missing; no ref → no ref key', () => {
    const state = emptyPlanet();
    const ctx = collector(3);
    treasury(state, ctx).add({
      colony: 1,
      amounts: { 'metals.t1': 5, 'metals.t2': 2, 'minerals.t3': 4, 'bio.biomass': 9, 'bio.water': 1 },
      reason: 'admin.correction',
      actor: admin,
    });
    expect(state.colonies).toHaveLength(2);
    const col = state.colonies[1];
    expect(col).toMatchObject({ index: 1, id: 'col_1', status: 'founding', changedAt: 3 });
    expect(col.stock).toEqual(fullStock({ 'metals.t1': 5, 'metals.t2': 2, 'minerals.t3': 4, 'bio.biomass': 9, 'bio.water': 1 }));
    expect(col.resources).toEqual({ metals: 7, minerals: 4, biomass: 9, water: 1 });
    expect(state.colonies[0].stock).toBeUndefined();
    expect(ctx.postings).toHaveLength(1);
    expect(ctx.postings[0]).not.toHaveProperty('ref');
  });

  it('moves nothing and records nothing when every amount is zero', () => {
    const state = emptyPlanet();
    const ctx = collector(1);
    const res = treasury(state, ctx).add({ colony: 0, amounts: { 'metals.t1': 0 }, reason: 'dev.grant', actor: DEV_ACTOR });
    expect(res).toEqual({ ok: true, credited: {}, overflow: {} });
    expect(ctx.postings).toEqual([]);
    expect(state.colonies).toHaveLength(0);
  });

});

describe('ColonyTreasury.add: caps and overflow', () => {
  it('clampToCap credits what fits under the family caps, reports the overflow and posts only the credit', () => {
    const state = emptyPlanet();
    const ctx = collector(2);
    const t = treasury(state, ctx);
    t.add({ colony: 0, amounts: { 'metals.t1': 550, 'bio.water': 450 }, reason: 'admin.correction', actor: admin });
    const res = t.add({
      colony: 0,
      amounts: { 'metals.t1': 100, 'bio.biomass': 30, 'bio.water': 40, 'minerals.t1': 20 },
      reason: 'terraform.yield',
      actor: colonyActor(state, 0),
      clampToCap: true,
      ref: 'tile:1,0',
    });
    // INITIAL_CAPS: metals 600 (room 50), bio 500 shared by biomass + water (room 50, filled in key order)
    expect(res).toMatchObject({
      ok: true,
      credited: { 'metals.t1': 50, 'bio.biomass': 30, 'bio.water': 20, 'minerals.t1': 20 },
      overflow: { 'metals.t1': 50, 'bio.water': 20 },
    });
    expect(getColonyStock(state, 0)).toEqual(fullStock({ 'metals.t1': 600, 'bio.biomass': 30, 'bio.water': 470, 'minerals.t1': 20 }));
    expect(ctx.postings).toHaveLength(2);
    expect(ctx.postings[1]).toEqual({
      at: 2,
      reason: 'terraform.yield',
      actor: 'colony:0',
      ref: 'tile:1,0',
      legs: [
        { account: 'sys:world', asset: 'bio.biomass', delta: -30 },
        { account: 'colony:0', asset: 'bio.biomass', delta: 30 },
        { account: 'sys:world', asset: 'bio.water', delta: -20 },
        { account: 'colony:0', asset: 'bio.water', delta: 20 },
        { account: 'sys:world', asset: 'metals.t1', delta: -50 },
        { account: 'colony:0', asset: 'metals.t1', delta: 50 },
        { account: 'sys:world', asset: 'minerals.t1', delta: -20 },
        { account: 'colony:0', asset: 'minerals.t1', delta: 20 },
      ],
    });
  });

  it('a fully capped clampToCap credit moves nothing and records nothing', () => {
    const state = emptyPlanet();
    state.colonies.push({ index: 0, id: 'col_0', name: 'A', color: 0, status: 'active', changedAt: 0, caps: { metals: 0 } });
    const ctx = collector();
    const res = treasury(state, ctx).add({ colony: 0, amounts: { 'metals.t1': 10 }, reason: 'production.tick', actor: admin, clampToCap: true });
    expect(res).toEqual({ ok: true, credited: {}, overflow: { 'metals.t1': 10 } });
    expect(ctx.postings).toEqual([]);
    expect(state.colonies[0].stock).toBeUndefined();
  });

  it('rejects a credit that would leave the safe-integer range, changing nothing (all keys)', () => {
    const state = emptyPlanet();
    setColonyStock(state, 0, { 'metals.t1': 5, 'minerals.t1': Number.MAX_SAFE_INTEGER });
    const before = structuredClone(state.colonies[0]);
    const ctx = collector(4);
    const res = treasury(state, ctx).add({ colony: 0, amounts: { 'metals.t1': 1, 'minerals.t1': 1 }, reason: 'trade', actor: admin });
    expect(res).toEqual({ ok: false, code: 'invalid_amount', resource: 'minerals.t1', detail: 'balance overflow' });
    expect(state.colonies[0]).toEqual(before);
    expect(ctx.postings).toEqual([]);
  });
});

describe('ColonyTreasury.withdraw', () => {
  it('debits into the reason counter account with one posting (colony → sys:construction)', () => {
    const state = emptyPlanet();
    setColonyStock(state, 0, { 'metals.t1': 100, 'minerals.t1': 10 });
    const ctx = collector(4);
    const res = treasury(state, ctx).withdraw({
      colony: 0,
      amounts: { 'metals.t1': 30, 'minerals.t1': 0 },
      reason: 'construction.spend',
      actor: 'player:p1',
      ref: 'order:9',
    });
    const posting = {
      at: 4,
      reason: 'construction.spend',
      actor: 'player:p1',
      ref: 'order:9',
      legs: [
        { account: 'colony:0', asset: 'metals.t1', delta: -30 },
        { account: 'sys:construction', asset: 'metals.t1', delta: 30 },
      ],
    };
    expect(res).toEqual({ ok: true, debited: { 'metals.t1': 30 }, posting });
    expect(ctx.postings).toEqual([posting]);
    expect(getColonyStock(state, 0)).toEqual(fullStock({ 'metals.t1': 70, 'minerals.t1': 10 }));
    expect(state.colonies[0].changedAt).toBe(4);
  });

  it('is all-or-nothing: rejects insufficient_funds with the first short resource and moves nothing', () => {
    const state = emptyPlanet();
    setColonyStock(state, 0, { 'metals.t1': 100, 'bio.water': 1 });
    const before = structuredClone(state.colonies[0]);
    const ctx = collector(8);
    const res = treasury(state, ctx).withdraw({
      colony: 0,
      amounts: { 'metals.t1': 50, 'bio.water': 5, 'minerals.t1': 3 },
      reason: 'construction.spend',
      actor: admin,
    });
    expect(res).toEqual({ ok: false, code: 'insufficient_funds', resource: 'bio.water', have: 1, need: 5 });
    expect(state.colonies[0]).toEqual(before);
    expect(ctx.postings).toEqual([]);
  });

  it('withdrawing nothing succeeds without a posting', () => {
    const state = emptyPlanet();
    const ctx = collector();
    expect(treasury(state, ctx).withdraw({ colony: 0, amounts: {}, reason: 'trade', actor: admin })).toEqual({ ok: true, debited: {} });
    expect(ctx.postings).toEqual([]);
  });
});

describe('treasury rejects', () => {
  const state = emptyPlanet();
  const ctx = collector();
  const t = treasury(state, ctx);
  const base = { colony: 0, amounts: { 'metals.t1': 1 }, actor: admin };

  it('reasons outside the catalog or not allowed in that direction', () => {
    expect(t.add({ ...base, reason: 'construction.spend' })).toEqual({ ok: false, code: 'invalid_reason', detail: 'construction.spend cannot add' });
    expect(t.withdraw({ ...base, reason: 'landing.cargo' })).toEqual({ ok: false, code: 'invalid_reason', detail: 'landing.cargo cannot withdraw' });
    expect(t.add({ ...base, reason: 'toString' as LedgerReason })).toMatchObject({ ok: false, code: 'invalid_reason' });
    expect(t.add({ ...base, reason: 'nope' as LedgerReason })).toMatchObject({ ok: false, code: 'invalid_reason' });
  });

  it('bad colony indices, unknown resources, fractions and negatives', () => {
    expect(t.add({ ...base, colony: -1, reason: 'trade' })).toEqual({ ok: false, code: 'invalid_amount', detail: 'bad colony index' });
    expect(t.add({ ...base, colony: 0.5, reason: 'trade' })).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(t.add({ ...base, amounts: { gold: 1 } as never, reason: 'trade' })).toEqual({ ok: false, code: 'invalid_resource', detail: 'gold' });
    expect(t.add({ ...base, amounts: { 'metals.t1': 0.5 }, reason: 'trade' })).toEqual({
      ok: false,
      code: 'invalid_amount',
      resource: 'metals.t1',
      detail: '0.5',
    });
    expect(t.withdraw({ ...base, amounts: { 'metals.t1': -1 }, reason: 'trade' })).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(t.add({ ...base, amounts: { 'metals.t1': Number.NaN }, reason: 'trade' })).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(t.add({ ...base, amounts: { 'metals.t1': 2 ** 53 }, reason: 'trade' })).toMatchObject({ ok: false, code: 'invalid_amount' });
  });

  it('no reject touched state or recorded a posting', () => {
    expect(state.colonies).toHaveLength(0);
    expect(ctx.postings).toEqual([]);
  });
});

describe('setStock / setColonyStock / reads', () => {
  it('moves a colony to exactly the target: one withdraw + one add admin.correction posting (missing keys = 0)', () => {
    const state = emptyPlanet();
    setColonyStock(state, 0, { 'metals.t1': 50, 'bio.water': 9, 'minerals.t2': 3 });
    const ctx = collector(5);
    expect(setColonyStock(state, 0, { 'metals.t1': 20, 'minerals.t1': 15, 'minerals.t2': 3 }, ctx)).toEqual({ ok: true });
    expect(getColonyStock(state, 0)).toEqual(fullStock({ 'metals.t1': 20, 'minerals.t1': 15, 'minerals.t2': 3 }));
    expect(ctx.postings).toEqual([
      {
        at: 5,
        reason: 'admin.correction',
        actor: 'system:admin',
        legs: [
          { account: 'colony:0', asset: 'bio.water', delta: -9 },
          { account: 'sys:admin', asset: 'bio.water', delta: 9 },
          { account: 'colony:0', asset: 'metals.t1', delta: -30 },
          { account: 'sys:admin', asset: 'metals.t1', delta: 30 },
        ],
      },
      {
        at: 5,
        reason: 'admin.correction',
        actor: 'system:admin',
        legs: [
          { account: 'sys:admin', asset: 'minerals.t1', delta: -15 },
          { account: 'colony:0', asset: 'minerals.t1', delta: 15 },
        ],
      },
    ]);
  });

  it('setColonyStock without a ctx discards postings and stamps the state tick', () => {
    const state = emptyPlanet();
    state.meta.tick = 42;
    expect(setColonyStock(state, 0, { 'metals.t1': 12 })).toEqual({ ok: true });
    expect(getColonyStock(state, 0)['metals.t1']).toBe(12);
    expect(state.colonies[0].changedAt).toBe(42);
  });

  it('a no-op target writes an explicit (zero) stock without postings; actor and ref are passed through', () => {
    const state = emptyPlanet();
    const ctx = collector(6);
    expect(new ColonyTreasury(state, ctx).setStock(0, {}, admin, 'seed')).toEqual({ ok: true });
    expect(state.colonies[0].stock).toEqual(fullStock());
    expect(state.colonies[0].resources).toEqual({ metals: 0, minerals: 0, biomass: 0, water: 0 });
    expect(state.colonies[0].changedAt).toBe(6);
    expect(ctx.postings).toEqual([]);
    new ColonyTreasury(state, ctx).setStock(0, { 'metals.t3': 2 }, DEV_ACTOR, 'seed');
    expect(ctx.postings).toMatchObject([{ actor: DEV_ACTOR, ref: 'seed', reason: 'admin.correction', at: 6 }]);
  });

  it('rejects an invalid target without moving anything', () => {
    const state = emptyPlanet();
    const ctx = collector();
    expect(setColonyStock(state, 0, { 'metals.t1': 1.5 }, ctx)).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(setColonyStock(state, 0, { 'metals.t1': -1 }, ctx)).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(setColonyStock(state, -2, {}, ctx)).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(state.colonies).toHaveLength(0);
    expect(ctx.postings).toEqual([]);
  });

  it('canAfford and findShortfall compare whole units in sorted key order', () => {
    const state = emptyPlanet();
    const t = treasury(state, unrecorded(0));
    setColonyStock(state, 0, { 'metals.t1': 200, 'bio.water': 10 });
    expect(t.stock(0)).toEqual(fullStock({ 'metals.t1': 200, 'bio.water': 10 }));
    expect(t.canAfford(0, { 'metals.t1': 200 })).toBe(true);
    expect(t.canAfford(0, { 'metals.t1': 201 })).toBe(false);
    expect(findShortfall(t.stock(0), { 'minerals.t1': 1, 'bio.water': 50, 'metals.t1': 0 })).toEqual({ resource: 'bio.water', have: 10, need: 50 });
    expect(findShortfall({} as never, { 'metals.t1': 1 })).toEqual({ resource: 'metals.t1', have: 0, need: 1 });
    expect(findShortfall(t.stock(0), {})).toBeNull();
    expect(findShortfall(t.stock(0), { 'metals.t1': undefined })).toBeNull();
  });
});
