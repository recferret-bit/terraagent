import { describe, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import {
  markColonyContact,
  maxActiveTrucesForHqTier,
  maxTruceHoursForHqTier,
  proposeTruce,
  respondTruce,
} from './index';

function makePlanetWithColonies(tiers: Array<1 | 2 | 3>): PlanetState {
  const state = createState({
    planetId: 'pl_w18_12',
    planetType: 'temperate',
    seed: 'w18-12-seed',
    radius: 32,
  });
  state.meta.tick = 100;
  tiers.forEach((tier, idx) => {
    const col = ensureColonyRecord(state, idx, 100);
    col.status = 'active';
    const r = insertRow(state.entities, state.meta.nextEntityId++, 100);
    state.entities.cols.kind[r] = ENTITY_KIND.hq;
    state.entities.cols.owner[r] = idx;
    state.entities.cols.tier[r] = tier;
    state.entities.cols.hp[r] = 500;
    state.entities.cols.hpMax[r] = 500;
    state.entities.cols.state[r] = ENTITY_STATE.idle;
    state.entities.cols.q[r] = idx * 4;
    state.entities.cols.r[r] = 0;
  });
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      markColonyContact(state, i, j, 100);
    }
  }
  return state;
}

describe('W18-12 truce terms — positive duration & cap cases (UO-DIP-02)', () => {
  it('allows 2, 6, 24 h on T1 HQ and 72 h on T2/T3 HQ, and enforces tier caps 1 / 2 / 4', () => {
    expect(maxTruceHoursForHqTier(1)).toBe(24);
    expect(maxTruceHoursForHqTier(2)).toBe(72);
    expect(maxTruceHoursForHqTier(3)).toBe(72);
    expect(maxActiveTrucesForHqTier(1)).toBe(1);
    expect(maxActiveTrucesForHqTier(2)).toBe(2);
    expect(maxActiveTrucesForHqTier(3)).toBe(4);

    const stateT1 = makePlanetWithColonies([1, 1]);
    for (const h of [2, 6, 24] as const) {
      expect(proposeTruce(stateT1, 0, 1, h, 100).ok).toBe(true);
    }

    const stateT2 = makePlanetWithColonies([2, 2, 2]);
    const p1 = proposeTruce(stateT2, 0, 1, 72, 100);
    expect(p1.ok).toBe(true);
    if (p1.ok) expect(respondTruce(stateT2, 1, p1.offer.offerId, true, 105).ok).toBe(true);

    const p2 = proposeTruce(stateT2, 0, 2, 72, 110);
    expect(p2.ok).toBe(true);
    if (p2.ok) expect(respondTruce(stateT2, 2, p2.offer.offerId, true, 115).ok).toBe(true);
  });
});

describe('W18-12 truce terms — negative tier_locked & truce_cap cases (UO-DIP-02)', () => {
  it('rejects 72 h offer on T1 HQ with tier_locked and rejects exceeding active truce cap with truce_cap', () => {
    const state = makePlanetWithColonies([1, 2, 2]);
    expect(proposeTruce(state, 0, 1, 72, 100)).toEqual({
      ok: false,
      code: 'tier_locked',
      detail: 'HQ T1 max truce duration is 24h',
    });

    const p1 = proposeTruce(state, 0, 1, 24, 100);
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect(respondTruce(state, 1, p1.offer.offerId, true, 105).ok).toBe(true);

    expect(proposeTruce(state, 0, 2, 6, 110)).toEqual({
      ok: false,
      code: 'truce_cap',
      detail: 'HQ T1 active truce cap (1) reached',
    });
    expect(proposeTruce(state, 2, 0, 6, 110)).toEqual({
      ok: false,
      code: 'truce_cap',
      detail: 'target HQ T1 active truce cap (1) reached',
    });
  });
});

describe('W18-12 truce terms — 10-minute offer expiry boundary cases', () => {
  it('accepts an offer at tick + 2999 and expires it at tick + 3000 (10 minutes)', () => {
    const state = makePlanetWithColonies([1, 1]);
    const prop = proposeTruce(state, 0, 1, 6, 100);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    expect(prop.offer.expiresAtTick).toBe(3100);

    expect(respondTruce(state, 1, prop.offer.offerId, true, 3100)).toEqual({
      ok: false,
      code: 'unknown_offer',
      detail: 'truce offer expired',
    });

    const prop2 = proposeTruce(state, 0, 1, 6, 3200);
    expect(prop2.ok).toBe(true);
    if (!prop2.ok) return;
    expect(respondTruce(state, 1, prop2.offer.offerId, true, 6199).ok).toBe(true);
  });
});
