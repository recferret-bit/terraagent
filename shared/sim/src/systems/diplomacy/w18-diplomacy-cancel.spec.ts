import { describe, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import {
  cancelColonyTrucesOnElimination,
  cancelTruce,
  hasActiveTruce,
  isColonyOathbreaker,
  markColonyContact,
  proposeTruce,
  readDiplomacyBlob,
  respondTruce,
} from './index';

function makePlanetWithSignedTruce(hours: 2 | 6 | 24 | 72 = 2): {
  state: PlanetState;
  truceId: string;
} {
  const state = createState({
    planetId: 'pl_w18_14',
    planetType: 'temperate',
    seed: 'w18-14-seed',
    radius: 24,
  });
  state.meta.tick = 100;
  for (const idx of [0, 1, 2]) {
    const col = ensureColonyRecord(state, idx, 100);
    col.status = 'active';
    const r = insertRow(state.entities, state.meta.nextEntityId++, 100);
    state.entities.cols.kind[r] = ENTITY_KIND.hq;
    state.entities.cols.owner[r] = idx;
    state.entities.cols.tier[r] = 2;
    state.entities.cols.hp[r] = 500;
    state.entities.cols.hpMax[r] = 500;
    state.entities.cols.state[r] = ENTITY_STATE.idle;
    state.entities.cols.q[r] = idx * 4;
    state.entities.cols.r[r] = 0;
  }
  markColonyContact(state, 0, 1, 100);
  markColonyContact(state, 0, 2, 100);
  markColonyContact(state, 1, 2, 100);

  const prop = proposeTruce(state, 0, 1, hours, 100);
  if (!prop.ok) throw new Error('expected proposeTruce to succeed');
  const resp = respondTruce(state, 1, prop.offer.offerId, true, 100);
  if (!resp.ok || !resp.truce) throw new Error('expected respondTruce to succeed');
  return { state, truceId: resp.truce.truceId };
}

describe('W18-14 truce cancellation & Oathbreaker — positive cases (UO-DIP-04)', () => {
  it('starts 10-min notice countdown where truce still holds, and marks only the canceller Oathbreaker for 24 h', () => {
    const { state, truceId } = makePlanetWithSignedTruce(6);
    const res = cancelTruce(state, 0, truceId, 200);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.truce.status).toBe('notice');
    expect(res.noticeEndsAtTick).toBe(3200);
    expect(res.oathbreakerUntilTick).toBe(200 + 24 * 3600 * 5);

    expect(hasActiveTruce(state, 0, 1, 200)).toBe(true);
    expect(hasActiveTruce(state, 0, 1, 3199)).toBe(true);
    expect(hasActiveTruce(state, 0, 1, 3200)).toBe(false);

    expect(isColonyOathbreaker(state, 0, 3200)).toBe(true);
    expect(isColonyOathbreaker(state, 1, 3200)).toBe(false);

    expect(proposeTruce(state, 0, 2, 2, 3200)).toEqual({
      ok: false,
      code: 'oathbreaker',
      detail: 'proposer is marked Oathbreaker',
    });
    expect(proposeTruce(state, 1, 2, 2, 3200).ok).toBe(true);
  });

  it('auto-cancels truces without Oathbreaker penalty when a colony is eliminated', () => {
    const { state, truceId } = makePlanetWithSignedTruce(6);
    cancelColonyTrucesOnElimination(state, 1, 500);
    expect(readDiplomacyBlob(state).truces[truceId]?.status).toBe('ended');
    expect(readDiplomacyBlob(state).truces[truceId]?.endReason).toBe('eliminated');
    expect(hasActiveTruce(state, 0, 1, 500)).toBe(false);
    expect(isColonyOathbreaker(state, 0, 500)).toBe(false);
    expect(isColonyOathbreaker(state, 1, 500)).toBe(false);
  });
});

describe('W18-14 truce cancellation & expiry — negative & boundary cases', () => {
  it('rejects cancelling an unknown truce, non-member truce, or a truce already in notice', () => {
    const { state, truceId } = makePlanetWithSignedTruce(6);
    expect(cancelTruce(state, 0, 'tr_unknown', 200)).toEqual({
      ok: false,
      code: 'unknown_truce',
      detail: 'active truce not found',
    });
    expect(cancelTruce(state, 2, truceId, 200)).toEqual({
      ok: false,
      code: 'unknown_truce',
      detail: 'active truce not found',
    });
    expect(cancelTruce(state, 0, truceId, 200).ok).toBe(true);
    expect(cancelTruce(state, 1, truceId, 210)).toEqual({
      ok: false,
      code: 'unknown_truce',
      detail: 'active truce not found',
    });
  });

  it('clamps noticeEndsAtTick to expiresAtTick when < 10 min remain, and clears Oathbreaker at exact 24 h boundary', () => {
    const { state, truceId } = makePlanetWithSignedTruce(2);
    const expiresAt = readDiplomacyBlob(state).truces[truceId]!.expiresAtTick;
    const cancelNearEnd = cancelTruce(state, 0, truceId, expiresAt - 500);
    expect(cancelNearEnd.ok).toBe(true);
    if (!cancelNearEnd.ok) return;
    expect(cancelNearEnd.noticeEndsAtTick).toBe(expiresAt);

    expect(isColonyOathbreaker(state, 0, cancelNearEnd.oathbreakerUntilTick - 1)).toBe(true);
    expect(isColonyOathbreaker(state, 0, cancelNearEnd.oathbreakerUntilTick)).toBe(false);
  });
});
