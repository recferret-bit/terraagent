import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  createState,
  DEFAULT_SHIELD_DURATION_TICKS,
  dropColonyShield,
  ensureColonyAt,
  ENTITY_KIND,
  ENTITY_STATE,
  initColonyNewcomerShield,
  insertRow,
  isColonyRaidProtected,
  isHostileTargetForAttacker,
  onHubDestroyed,
  placeSpawnedEntity,
  PREP,
  removeRow,
  rowOf,
  stepEliminationAndRuins,
  syncColonyNewcomerShield,
  TERRAIN,
  TICKS_PER_SECOND,
  type PlanetState,
} from '../../index';
import { applyAutopilot, openAwaySession } from '../away';
import { gateAwayCommand } from '../away/gate';
import { readDiplomacyBlob, writeDiplomacyBlob } from '../diplomacy/store';

function addEntity(
  state: PlanetState,
  spec: { kind: number; owner: number; q: number; r: number; hp?: number; state?: number },
): { id: number; row: number } {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  state.entities.cols.kind[row] = spec.kind;
  state.entities.cols.owner[row] = spec.owner;
  state.entities.cols.hp[row] = spec.hp ?? 500;
  state.entities.cols.hpMax[row] = spec.hp ?? 500;
  state.entities.cols.state[row] = spec.state ?? ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, row, spec.q, spec.r, 0);
  return { id, row };
}

describe('W18-27 · Spec 1: Newcomer shield property (AC-06)', () => {
  it('enforces AC-06 across stage/tick/action matrix: protected iff < S4 AND < 6h AND has not raided', () => {
    const state = createState({ planetId: 'pl-ac06', planetType: 'temperate', seed: 'ac06', radius: 18 });
    for (const stage of [0, 1, 2, 3, 4]) {
      for (const tickOffset of [0, 1000, DEFAULT_SHIELD_DURATION_TICKS - 1, DEFAULT_SHIELD_DURATION_TICKS, DEFAULT_SHIELD_DURATION_TICKS + 100]) {
        const colIdx = stage;
        const col = ensureColonyAt(state, colIdx, 0);
        col.stage = stage;
        col.createdAt = 0;
        initColonyNewcomerShield(state, colIdx, 0);
        syncColonyNewcomerShield(state, colIdx, tickOffset);
        const expected = stage < 4 && tickOffset < DEFAULT_SHIELD_DURATION_TICKS;
        expect(isColonyRaidProtected(state, colIdx, tickOffset)).toBe(expected);
      }
    }

    // Dropping shield via offensive raid action permanently ends newcomer protection even at S2 < 6h
    const col2 = ensureColonyAt(state, 2, 0);
    col2.stage = 2;
    initColonyNewcomerShield(state, 2, 0);
    expect(isColonyRaidProtected(state, 2, 500)).toBe(true);
    dropColonyShield(state, 2, 500);
    expect(isColonyRaidProtected(state, 2, 500)).toBe(false);
    expect(isColonyRaidProtected(state, 2, 1000)).toBe(false);
  });
});

describe('W18-27 · Spec 2: Truce no-damage & no-targeting property (AC-12)', () => {
  it('enforces AC-12: active or 10-min cancel-notice truce blocks all unit/turret targeting and applyDamage between partners', () => {
    const state = createState({ planetId: 'pl-ac12', planetType: 'temperate', seed: 'ac12', radius: 18 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.wild);
    ensureColonyAt(state, 0, 0).stage = 4;
    ensureColonyAt(state, 1, 0).stage = 4;

    const uA = addEntity(state, { kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, hp: 200 });
    const uB = addEntity(state, { kind: ENTITY_KIND.recon, owner: 1, q: 2, r: 0, hp: 200 });

    expect(isHostileTargetForAttacker(state, uA.row, uB.row)).toBe(true);

    const dip = readDiplomacyBlob(state);
    dip.truces['t1'] = {
      truceId: 't1', colonyA: 0, colonyB: 1, colonyAIndex: 0, colonyBIndex: 1,
      colonyAId: 'col-0', colonyBId: 'col-1', hours: 6, durationHours: 6,
      signedAtTick: 10, startedAtTick: 10, expiresAtTick: 50_000, status: 'active',
    };
    writeDiplomacyBlob(state, dip, 10);

    expect(isHostileTargetForAttacker(state, uA.row, uB.row)).toBe(false);
    const dmgActive = applyDamage(state, uB.id, 50, { attackerId: uA.id, attackerOwner: 0, tick: 20 });
    expect(dmgActive.applied).toBe(0);
    expect(state.entities.cols.hp[uB.row]).toBe(200);

    // Cancel-notice window also preserves AC-12 no-damage
    dip.truces['t1']!.status = 'notice';
    dip.truces['t1']!.noticeEndsAtTick = 3_010;
    writeDiplomacyBlob(state, dip, 25);
    expect(isHostileTargetForAttacker(state, uA.row, uB.row)).toBe(false);
    const dmgNotice = applyDamage(state, uB.id, 50, { attackerId: uA.id, attackerOwner: 0, tick: 100 });
    expect(dmgNotice.applied).toBe(0);
    expect(state.entities.cols.hp[uB.row]).toBe(200);
  });
});

describe('W18-27 · Spec 3: Away AI never cancels truces property (AC-13)', () => {
  it('enforces AC-13: while away, AI may propose or respond to truces but diplomacy.cancelTruce is always rejected away_policy', () => {
    const state = createState({ planetId: 'pl-ac13', planetType: 'temperate', seed: 'ac13', radius: 16 });
    ensureColonyAt(state, 0, 0);
    applyAutopilot(state, 0, { mode: 'director', awayRaids: true });
    openAwaySession(state, 0, 'col_0', { metals: 0, minerals: 0, bio: 0 }, 0);

    const fakeCtx = { tick: 10, flags: new Set(['W09', 'W18']) } as never;
    const cancelRej = gateAwayCommand(
      state,
      { commandId: 'c1', colonyIndex: 0, source: 'ai', kind: 'diplomacy.cancelTruce', args: { truceId: 't1' } },
      fakeCtx,
    );
    expect(cancelRej?.code).toBe('away_policy');

    const proposeOk = gateAwayCommand(
      state,
      { commandId: 'c2', colonyIndex: 0, source: 'ai', kind: 'diplomacy.proposeTruce', args: { toColony: 1, hours: 6 } },
      fakeCtx,
    );
    expect(proposeOk).toBeUndefined();

    const respondOk = gateAwayCommand(
      state,
      { commandId: 'c3', colonyIndex: 0, source: 'ai', kind: 'diplomacy.respondTruce', args: { offerId: 'o1', accept: true } },
      fakeCtx,
    );
    expect(respondOk).toBeUndefined();
  });
});

describe('W18-27 · Spec 4: Critical 10-min elimination timer & Hub loss property', () => {
  it('enters critical with a 10-min (3000-tick) deadline on Hub loss and eliminates the colony when timer expires', () => {
    const state = createState({ planetId: 'pl-elim', planetType: 'temperate', seed: 'elim', radius: 18 });
    const col0 = ensureColonyAt(state, 0, 0);
    col0.status = 'active';
    col0.stage = 3;

    const hub = addEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, hp: 1500 });
    const hq = addEntity(state, { kind: ENTITY_KIND.hq, owner: 0, q: 1, r: 0, hp: 900 });
    const solar = addEntity(state, { kind: ENTITY_KIND.solar, owner: 0, q: 2, r: 0, hp: 400 });

    removeRow(state.entities, hub.id, 100);
    onHubDestroyed(state, 0, hub.id, 100);
    expect(col0.status).toBe('critical');
    expect(col0.criticalDeadlineTick).toBe(100 + 600 * TICKS_PER_SECOND);

    const fakeCtx = {
      dt: 1,
      tick: 100 + 600 * TICKS_PER_SECOND,
      flags: new Set(['W18']),
      emit: () => {},
      events: [],
    } as never;
    stepEliminationAndRuins(state, fakeCtx);
    expect(col0.status).toBe('eliminated');
    expect(rowOf(state.entities, hq.id)).toBe(-1);
    expect(state.entities.cols.owner[rowOf(state.entities, solar.id)]).toBe(-1);
  });
});
