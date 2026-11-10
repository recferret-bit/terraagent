import { describe, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { insertRow } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { markTileExplored } from '../../grid/tileModel';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import {
  hasActiveTruce,
  markColonyContact,
  markColonyOathbreaker,
  proposeTruce,
  recordHostilityBetween,
  respondTruce,
  setColonyNoContact,
} from './index';

function makePlanetWithTwoColonies(hqDist = 20): PlanetState {
  const state = createState({
    planetId: 'pl_w18_11',
    planetType: 'temperate',
    seed: 'w18-11-seed',
    radius: 32,
  });
  state.meta.tick = 100;
  const col0 = ensureColonyRecord(state, 0, 100);
  col0.status = 'active';
  const col1 = ensureColonyRecord(state, 1, 100);
  col1.status = 'active';

  const r0 = insertRow(state.entities, state.meta.nextEntityId++, 100);
  state.entities.cols.kind[r0] = ENTITY_KIND.hq;
  state.entities.cols.owner[r0] = 0;
  state.entities.cols.tier[r0] = 1;
  state.entities.cols.hp[r0] = 500;
  state.entities.cols.hpMax[r0] = 500;
  state.entities.cols.state[r0] = ENTITY_STATE.idle;
  state.entities.cols.q[r0] = 0;
  state.entities.cols.r[r0] = 0;

  const r1 = insertRow(state.entities, state.meta.nextEntityId++, 100);
  state.entities.cols.kind[r1] = ENTITY_KIND.hq;
  state.entities.cols.owner[r1] = 1;
  state.entities.cols.tier[r1] = 1;
  state.entities.cols.hp[r1] = 500;
  state.entities.cols.hpMax[r1] = 500;
  state.entities.cols.state[r1] = ENTITY_STATE.idle;
  state.entities.cols.q[r1] = hqDist;
  state.entities.cols.r[r1] = 0;

  return state;
}

describe('W18-11 diplomacy offer & response — positive cases (UO-DIP-01)', () => {
  it('proposes and accepts a truce when first contact is established and both HQs are alive', () => {
    const state = makePlanetWithTwoColonies(20);
    markColonyContact(state, 0, 1, 100);

    const prop = proposeTruce(state, 0, 1, 6, 100);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    expect(prop.offer.fromColonyId).toBe('col_0');
    expect(prop.offer.toColonyId).toBe('col_1');
    expect(prop.offer.durationHours).toBe(6);
    expect(prop.offer.status).toBe('pending');

    const inc = (state.colonies[1]?.diplomacy as { incomingOffers?: unknown[] })?.incomingOffers;
    expect(inc).toHaveLength(1);

    const resp = respondTruce(state, 1, prop.offer.offerId, true, 110);
    expect(resp.ok).toBe(true);
    if (!resp.ok) return;
    expect(resp.truce?.status).toBe('active');
    expect(hasActiveTruce(state, 0, 1, 110)).toBe(true);
  });

  it('establishes first contact via explored foreign tile or proximity <= 14 hexes, and allows declining an offer', () => {
    const state = makePlanetWithTwoColonies(20);
    const idx = hexIndex(state.grid.radius).indexOf(20, 0);
    state.grid.layers.owner[idx] = 1;
    markTileExplored(state.grid, idx, 0);

    const prop = proposeTruce(state, 0, 'col_1', 2, 100);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;

    const dec = respondTruce(state, 1, prop.offer.offerId, false, 105);
    expect(dec.ok).toBe(true);
    expect(hasActiveTruce(state, 0, 1, 105)).toBe(false);
  });
});

describe('W18-11 diplomacy offer & response — negative cases (UO-DIP-01)', () => {
  it('rejects proposeTruce with recent_hostility right after a fight, no_contact without contact, and oathbreaker when marked', () => {
    const state = makePlanetWithTwoColonies(20);
    expect(proposeTruce(state, 0, 1, 6, 100)).toEqual({
      ok: false,
      code: 'no_contact',
      detail: expect.any(String),
    });

    recordHostilityBetween(state, 0, 1, 200);
    expect(proposeTruce(state, 0, 1, 6, 250)).toEqual({
      ok: false,
      code: 'recent_hostility',
      detail: expect.any(String),
    });

    setColonyNoContact(state, 0, 1, 4000);
    expect(proposeTruce(state, 0, 1, 6, 4000)).toEqual({
      ok: false,
      code: 'no_contact',
      detail: expect.any(String),
    });

    markColonyContact(state, 0, 1, 4000);
    markColonyOathbreaker(state, 0, 10000, 4000);
    expect(proposeTruce(state, 0, 1, 6, 4000)).toEqual({
      ok: false,
      code: 'oathbreaker',
      detail: expect.any(String),
    });
  });

  it('rejects proposeTruce when either HQ is down, self-targeting, or truce already active, and rejects unknown_offer on respondTruce', () => {
    const state = makePlanetWithTwoColonies(10);
    expect(proposeTruce(state, 0, 0, 6, 100).ok).toBe(false);

    state.entities.cols.hp[1] = 0;
    expect(proposeTruce(state, 0, 1, 6, 100)).toEqual({
      ok: false,
      code: 'invalid_args',
      detail: 'both HQs must be alive',
    });

    state.entities.cols.hp[1] = 500;
    const prop = proposeTruce(state, 0, 1, 6, 100);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;

    expect(respondTruce(state, 0, prop.offer.offerId, true, 105)).toEqual({
      ok: false,
      code: 'unknown_offer',
      detail: expect.any(String),
    });

    expect(respondTruce(state, 1, prop.offer.offerId, true, 105).ok).toBe(true);
    expect(proposeTruce(state, 0, 1, 6, 110)).toEqual({
      ok: false,
      code: 'truce_active',
      detail: expect.any(String),
    });
  });
});

describe('W18-11 diplomacy offer & response — boundary cases', () => {
  it('enforces exact 10-minute (3000-tick) hostility cooldown and proximity distance 14 vs 15', () => {
    const stateFar = makePlanetWithTwoColonies(15);
    expect(proposeTruce(stateFar, 0, 1, 6, 100).ok).toBe(false);

    const stateNear = makePlanetWithTwoColonies(14);
    expect(proposeTruce(stateNear, 0, 1, 6, 100).ok).toBe(true);

    recordHostilityBetween(stateNear, 0, 1, 1000);
    expect(proposeTruce(stateNear, 0, 1, 6, 3999)).toEqual({
      ok: false,
      code: 'recent_hostility',
      detail: expect.any(String),
    });
    expect(proposeTruce(stateNear, 0, 1, 6, 4000).ok).toBe(true);
  });
});
