import { describe, expect, it } from 'vitest';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState, type PlanetState } from '../../kernel/state';
import {
  acquireClosestTargetInRange,
  isHostileTargetForAttacker,
} from '../combat/targeting';
import {
  cancelTruce,
  markColonyContact,
  proposeTruce,
  respondTruce,
} from './index';

function makeCombatTruceState(): {
  state: PlanetState;
  turretRow: number;
  partnerUnitRow: number;
  enemyUnitRow: number;
} {
  const state = createState({
    planetId: 'pl_w18_13',
    planetType: 'temperate',
    seed: 'w18-13-seed',
    radius: 24,
  });
  state.meta.tick = 100;
  for (const idx of [0, 1, 2]) {
    const col = ensureColonyRecord(state, idx, 100);
    col.status = 'active';
    const hq = insertRow(state.entities, state.meta.nextEntityId++, 100);
    state.entities.cols.kind[hq] = ENTITY_KIND.hq;
    state.entities.cols.owner[hq] = idx;
    state.entities.cols.tier[hq] = 1;
    state.entities.cols.hp[hq] = 500;
    state.entities.cols.hpMax[hq] = 500;
    state.entities.cols.state[hq] = ENTITY_STATE.idle;
    placeSpawnedEntity(state.entities, hq, idx * 6, 0, 100);
  }

  const turretRow = insertRow(state.entities, state.meta.nextEntityId++, 100);
  state.entities.cols.kind[turretRow] = ENTITY_KIND.autocannon;
  state.entities.cols.owner[turretRow] = 0;
  state.entities.cols.hp[turretRow] = 200;
  state.entities.cols.hpMax[turretRow] = 200;
  state.entities.cols.state[turretRow] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, turretRow, 1, 0, 100);

  const partnerUnitRow = insertRow(state.entities, state.meta.nextEntityId++, 100);
  state.entities.cols.kind[partnerUnitRow] = ENTITY_KIND.recon;
  state.entities.cols.owner[partnerUnitRow] = 1;
  state.entities.cols.hp[partnerUnitRow] = 100;
  state.entities.cols.hpMax[partnerUnitRow] = 100;
  state.entities.cols.state[partnerUnitRow] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, partnerUnitRow, 2, 0, 100);

  const enemyUnitRow = insertRow(state.entities, state.meta.nextEntityId++, 100);
  state.entities.cols.kind[enemyUnitRow] = ENTITY_KIND.recon;
  state.entities.cols.owner[enemyUnitRow] = 2;
  state.entities.cols.hp[enemyUnitRow] = 100;
  state.entities.cols.hpMax[enemyUnitRow] = 100;
  state.entities.cols.state[enemyUnitRow] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, enemyUnitRow, 3, 0, 100);

  markColonyContact(state, 0, 1, 100);
  return { state, turretRow, partnerUnitRow, enemyUnitRow };
}

describe('W18-13 truce effects on targeting — positive, negative & notice boundary cases (UO-DIP-03)', () => {
  it('turrets and units ignore truce partner while still acquiring non-truce enemies', () => {
    const { state, turretRow, partnerUnitRow, enemyUnitRow } = makeCombatTruceState();

    expect(isHostileTargetForAttacker(state, turretRow, partnerUnitRow)).toBe(true);
    expect(
      acquireClosestTargetInRange(state, turretRow, {
        requireSpotting: false,
        maxRange: 5,
      }),
    ).toBe(partnerUnitRow);

    const prop = proposeTruce(state, 0, 1, 6, 100);
    if (!prop.ok) throw new Error('expected proposeTruce to succeed');
    expect(respondTruce(state, 1, prop.offer.offerId, true, 100).ok).toBe(true);

    expect(isHostileTargetForAttacker(state, turretRow, partnerUnitRow)).toBe(false);
    expect(isHostileTargetForAttacker(state, partnerUnitRow, turretRow)).toBe(false);
    expect(isHostileTargetForAttacker(state, turretRow, enemyUnitRow)).toBe(true);
    expect(
      acquireClosestTargetInRange(state, turretRow, {
        requireSpotting: false,
        maxRange: 5,
      }),
    ).toBe(enemyUnitRow);
  });

  it('continues ignoring truce partner during 10-min cancel notice and resumes targeting once notice expires', () => {
    const { state, turretRow, partnerUnitRow } = makeCombatTruceState();
    const prop = proposeTruce(state, 0, 1, 6, 100);
    if (!prop.ok) throw new Error('expected proposeTruce to succeed');
    const resp = respondTruce(state, 1, prop.offer.offerId, true, 100);
    if (!resp.ok || !resp.truce) throw new Error('expected respondTruce to succeed');

    expect(cancelTruce(state, 0, resp.truce.truceId, 200).ok).toBe(true);
    state.meta.tick = 3199;
    expect(isHostileTargetForAttacker(state, turretRow, partnerUnitRow)).toBe(false);

    state.meta.tick = 3200;
    expect(isHostileTargetForAttacker(state, turretRow, partnerUnitRow)).toBe(true);
  });
});
