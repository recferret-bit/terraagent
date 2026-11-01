import { describe, expect, it } from 'vitest';
import { RESOURCE_KEYS } from '@terra/contracts';
import {
  DEV_ACTOR,
  INITIAL_CAPS,
  LEDGER_REASONS,
  clampToCaps,
  colonyAccount,
  colonyActor,
  colonyIndexOfAccount,
  emptyStock,
  getColonyCaps,
  getColonyStock,
  isLedgerReason,
  isSystemAccount,
  reasonAllows,
  systemActor,
} from '../../src';
import { emptyPlanet, fullStock } from './helpers';

describe('accounts and actors', () => {
  it('names colony and system accounts', () => {
    expect(colonyAccount(3)).toBe('colony:3');
    expect(colonyIndexOfAccount('colony:12')).toBe(12);
    expect(colonyIndexOfAccount('sys:world')).toBe(-1);
    expect(colonyIndexOfAccount('colony:x')).toBe(-1);
    expect(isSystemAccount('sys:construction')).toBe(true);
    expect(isSystemAccount('colony:0')).toBe(false);
  });

  it('colonyActor is the player when known, else the colony; systemActor and DEV_ACTOR', () => {
    const state = emptyPlanet();
    state.colonies.push({ index: 0, id: 'col_0', name: 'A', color: 0, status: 'active', changedAt: 0, playerId: 'p_1' });
    state.colonies.push({ index: 1, id: 'col_1', name: 'B', color: 0, status: 'active', changedAt: 0, playerId: '' });
    expect(colonyActor(state, 0)).toBe('player:p_1');
    expect(colonyActor(state, 1)).toBe('colony:1');
    expect(colonyActor(state, 5)).toBe('colony:5');
    expect(systemActor('terraform')).toBe('system:terraform');
    expect(DEV_ACTOR).toBe('dev:console');
  });
});

describe('reason catalog', () => {
  it('every reason has a direction and a sys:* counter account', () => {
    for (const [reason, spec] of Object.entries(LEDGER_REASONS)) {
      expect(isLedgerReason(reason)).toBe(true);
      expect(isSystemAccount(spec.counter)).toBe(true);
      expect(spec.directions.length).toBeGreaterThan(0);
      expect(spec.summary.length).toBeGreaterThan(0);
    }
    expect(LEDGER_REASONS['construction.spend'].counter).toBe(LEDGER_REASONS['construction.refund'].counter);
  });

  it('isLedgerReason / reasonAllows', () => {
    expect(isLedgerReason('hasOwnProperty')).toBe(false);
    expect(isLedgerReason(7)).toBe(false);
    expect(reasonAllows('landing.cargo', 'add')).toBe(true);
    expect(reasonAllows('landing.cargo', 'withdraw')).toBe(false);
    expect(reasonAllows('trade', 'withdraw')).toBe(true);
  });
});

describe('caps', () => {
  it('getColonyCaps falls back to INITIAL_CAPS per field', () => {
    const state = emptyPlanet();
    expect(getColonyCaps(state, 0)).toEqual(INITIAL_CAPS);
    state.colonies.push({ index: 0, id: 'col_0', name: 'A', color: 0, status: 'active', changedAt: 0, caps: { metals: 500, bio: 'x' } });
    expect(getColonyCaps(state, 0)).toEqual({ ...INITIAL_CAPS, metals: 500 });
  });

  it('clampToCaps fills shared family room in key order and never credits negatives', () => {
    const caps = { metals: 100, minerals: 50, energy: 0, bio: 10, item: 0 };
    const stock = fullStock({ 'metals.t1': 60, 'metals.t2': 30, 'minerals.t1': 80 });
    expect(clampToCaps(stock, caps, { 'metals.t2': 5, 'metals.t1': 20, 'minerals.t1': 3, 'bio.water': 7, 'bio.biomass': 6 })).toEqual({
      credited: { 'metals.t1': 10, 'bio.biomass': 6, 'bio.water': 4 },
      overflow: { 'metals.t1': 10, 'metals.t2': 5, 'minerals.t1': 3, 'bio.water': 3 },
    });
    expect(clampToCaps(stock, caps, { 'metals.t1': 0, 'bio.water': undefined })).toEqual({ credited: {}, overflow: {} });
  });
});

describe('stock store', () => {
  it('emptyStock and getColonyStock are zero-filled over every resource key', () => {
    const state = emptyPlanet();
    expect(Object.keys(emptyStock()).sort()).toEqual([...RESOURCE_KEYS].sort());
    expect(Object.values(emptyStock()).every((v) => v === 0)).toBe(true);
    expect(getColonyStock(state, 4)).toEqual(emptyStock());
  });

  it('getColonyStock reads col.stock, zero-fills missing keys and ignores a non-object stock', () => {
    const state = emptyPlanet();
    state.colonies.push({ index: 0, id: 'col_0', name: 'A', color: 0, status: 'active', changedAt: 0, stock: { 'metals.t1': 7 } as never });
    state.colonies.push({ index: 1, id: 'col_1', name: 'B', color: 0, status: 'active', changedAt: 0, stock: 'junk' as never });
    expect(getColonyStock(state, 0)).toEqual(fullStock({ 'metals.t1': 7 }));
    expect(getColonyStock(state, 1)).toEqual(emptyStock());
    const read = getColonyStock(state, 0);
    read['metals.t1'] = 99;
    expect(getColonyStock(state, 0)['metals.t1']).toBe(7);
  });
});
