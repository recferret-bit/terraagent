import { describe, expect, it } from 'vitest';
import {
  SHORTFALL_ORDER,
  amountsProblem,
  isResourceKey,
  isWholeAmount,
  reportTreasuryReject,
  treasury,
  treasuryCtx,
  type EmitInput,
} from '../../src';
import { RESOURCE_KEYS } from '@terra/contracts';
import { emptyPlanet } from './helpers';

describe('whole amounts (the one rule for treasury and data)', () => {
  it('isWholeAmount accepts safe integers >= 0 only', () => {
    for (const ok of [0, 1, 600, Number.MAX_SAFE_INTEGER]) expect(isWholeAmount(ok)).toBe(true);
    for (const bad of [600.5, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '5', null, undefined]) expect(isWholeAmount(bad)).toBe(false);
  });

  it('isResourceKey and amountsProblem', () => {
    expect(isResourceKey('metals.t1')).toBe(true);
    expect(isResourceKey('gold')).toBe(false);
    expect(isResourceKey(3)).toBe(false);
    expect(amountsProblem({ 'metals.t1': 600, 'bio.water': 0 })).toBeNull();
    expect(amountsProblem({ gold: 1 })).toEqual({ code: 'invalid_resource', detail: 'gold' });
    expect(amountsProblem({ 'metals.t1': 600.5 })).toEqual({ code: 'invalid_amount', resource: 'metals.t1', detail: '600.5' });
  });

  it('SHORTFALL_ORDER lists every resource key once', () => {
    expect([...SHORTFALL_ORDER].sort()).toEqual([...RESOURCE_KEYS].sort());
  });
});

describe('reportTreasuryReject', () => {
  it('emits one treasuryRejected warning through the ctx, and nothing without an event sink', () => {
    const state = emptyPlanet();
    const events: EmitInput[] = [];
    const ctx = treasuryCtx(4, { record: () => {}, emit: (e) => void events.push(e) });
    const req = { colony: 0, amounts: { 'metals.t1': 0.5 }, reason: 'terraform.yield' as const, actor: 'colony:0', ref: 'tile:1,2' };
    const res = treasury(state, ctx).add(req);
    if (res.ok) throw new Error('expected a reject');
    reportTreasuryReject(ctx, state, req, res);
    expect(events).toEqual([{
      kind: 'treasuryRejected', severity: 'warn', colonyIds: ['col_0'],
      data: { colonyId: 'col_0', reason: 'terraform.yield', code: 'invalid_amount', resource: 'metals.t1', detail: '0.5', ref: 'tile:1,2' },
    }]);

    state.colonies.push({ index: 0, id: 'col_x', name: 'A', color: 0, status: 'active', changedAt: 0 });
    reportTreasuryReject(ctx, state, { ...req, ref: undefined }, { ok: false, code: 'invalid_reason' });
    expect(events[1]).toEqual({ kind: 'treasuryRejected', severity: 'warn', colonyIds: ['col_x'], data: { colonyId: 'col_x', reason: 'terraform.yield', code: 'invalid_reason' } });

    expect(() => reportTreasuryReject(treasuryCtx(4), state, req, res)).not.toThrow();
    expect(events).toHaveLength(2);
  });
});
