import { describe, expect, it } from 'vitest';
import {
  TruceEndedDataSchema,
  TruceNoticeDataSchema,
  TruceOfferedDataSchema,
  TruceSignedDataSchema,
  WarDeclaredDataSchema,
  WarEndedDataSchema,
} from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { StepContext } from '../../kernel/context';
import { createState, type PlanetState } from '../../kernel/state';
import { checkAiCancelTrucePolicy } from '../away/gate';
import { handleBuildingDestruction } from '../combat/parts/damageHelpers';
import { creditResource, ensureColonyLedger } from '../economy/ledger';
import { getUnitSiphonedAmount, stepRaidSiphon } from '../pvp/siphon';
import {
  cancelColonyTrucesOnElimination,
  cancelTruce,
  cancelWar,
  declareWar,
  hasActiveWar,
  markColonyContact,
  proposeTruce,
  readDiplomacyBlob,
  respondTruce,
  stepDiplomacy,
  warBondDurationTicks,
} from './index';

function makeDiplomacyPlanet(): { state: PlanetState; events: Array<{ kind: string; data: Record<string, unknown> }>; ctx: StepContext } {
  const state = createState({
    planetId: 'pl_war_bonds',
    planetType: 'temperate',
    seed: 'war-bonds-seed',
    radius: 24,
  });
  state.meta.tick = 1_000;
  for (const idx of [0, 1, 2]) {
    const col = ensureColonyRecord(state, idx, 1_000);
    col.status = 'active';
    col.stage = 4;
    const r = insertRow(state.entities, state.meta.nextEntityId++, 1_000);
    state.entities.cols.kind[r] = ENTITY_KIND.hq;
    state.entities.cols.owner[r] = idx;
    state.entities.cols.tier[r] = 2;
    state.entities.cols.hp[r] = 500;
    state.entities.cols.hpMax[r] = 500;
    state.entities.cols.state[r] = ENTITY_STATE.idle;
    placeSpawnedEntity(state.entities, r, idx * 6, 0, 1_000);
  }
  markColonyContact(state, 0, 1, 1_000);
  markColonyContact(state, 0, 2, 1_000);
  const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const ctx = {
    tick: 1_000,
    dt: 1,
    flags: new Set(['W18', 'W22']),
    emit: (ev: { kind: string; data?: Record<string, unknown> }) => {
      events.push({ kind: ev.kind, data: ev.data ?? {} });
    },
  } as unknown as StepContext;
  return { state, events, ctx };
}

describe('Bonded Peace Treaties in @terra/sim', () => {
  it('propagates bondToken and bondAmount across truceOffered, truceSigned, truceNotice, and truceEnded', () => {
    const { state, events, ctx } = makeDiplomacyPlanet();
    const offered = proposeTruce(state, 0, 1, 6, 1_000, ctx, { bondToken: 'NEAR', bondAmount: 5 });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(offered.offer.bondToken).toBe('NEAR');
    expect(offered.offer.bondAmount).toBe(5);
    expect(events.find((e) => e.kind === 'truceOffered')?.data.bondAmount).toBe(5);

    const signed = respondTruce(state, 1, offered.offer.offerId, true, 1_010, ctx);
    expect(signed.ok).toBe(true);
    if (!signed.ok || !signed.truce) return;
    expect(signed.truce.bondAmount).toBe(5);
    expect(events.find((e) => e.kind === 'truceSigned')?.data.bondToken).toBe('NEAR');

    const cancelled = cancelTruce(state, 0, signed.truce.truceId, 1_100, ctx);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;

    (ctx as { tick: number }).tick = cancelled.noticeEndsAtTick;
    stepDiplomacy(state, ctx);
    const ended = events.find((e) => e.kind === 'truceEnded');
    expect(ended?.data.reason).toBe('cancelled');
    expect(ended?.data.bondAmount).toBe(5);
    expect(ended?.data.cancelledByColony).toBe(0);

    expect(() => TruceOfferedDataSchema.parse(events.find((e) => e.kind === 'truceOffered')!.data)).not.toThrow();
    expect(() => TruceSignedDataSchema.parse(events.find((e) => e.kind === 'truceSigned')!.data)).not.toThrow();
    expect(() => TruceNoticeDataSchema.parse(events.find((e) => e.kind === 'truceNotice')!.data)).not.toThrow();
    expect(() => TruceEndedDataSchema.parse(ended!.data)).not.toThrow();
  });
});

describe('6h War Bonds lifecycle, objectives, and slashing', () => {
  it('declares 6h war, blocks truce while active, and slashes on early cancelWar or 6h expiry', () => {
    const { state, events, ctx } = makeDiplomacyPlanet();
    state.colonies[1]!.stage = 1;
    state.colonies[1]!.raidProtectedUntil = 50_000;
    expect(declareWar(state, 0, 1, 5, 'NEAR', 1_000, ctx).ok).toBe(false);
    state.colonies[1]!.stage = 4;
    state.colonies[1]!.raidProtectedUntil = 0;

    const res = declareWar(state, 0, 1, 5, 'NEAR', 1_000, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(hasActiveWar(state, 0, 1, 1_000)).toBe(true);
    expect(res.war.expiresAtTick).toBe(1_000 + warBondDurationTicks());

    const dup = declareWar(state, 0, 1, 5, 'NEAR', 1_001, ctx);
    expect(dup).toEqual({ ok: false, code: 'war_active', detail: 'bonded war already active against target' });

    const truceAttempt = proposeTruce(state, 1, 0, 6, 8_000, ctx);
    expect(truceAttempt).toEqual({ ok: false, code: 'war_active', detail: 'bonded war active between colonies' });

    const cancelled = cancelWar(state, 0, res.war.warId, 2_000, ctx);
    expect(cancelled.ok).toBe(true);
    const cancelEv = events.find((e) => e.kind === 'warEnded' && e.data.warId === res.war.warId);
    expect(cancelEv?.data.reason).toBe('cancelled');
    expect(cancelEv?.data.slashedToDefender).toBe(true);

    const war2 = declareWar(state, 0, 2, 50, 'metals.t1', 2_100, ctx);
    expect(war2.ok).toBe(true);
    if (!war2.ok) return;
    (ctx as { tick: number }).tick = war2.war.expiresAtTick;
    stepDiplomacy(state, ctx);
    const expEv = events.find((e) => e.kind === 'warEnded' && e.data.warId === war2.war.warId);
    expect(expEv?.data.reason).toBe('expired');
    expect(expEv?.data.slashedToDefender).toBe(true);
  });

  it('completes war with objective_met when attacker destroys 1 foreign structure', () => {
    const { state, events, ctx } = makeDiplomacyPlanet();
    const war = declareWar(state, 0, 1, 5, 'NEAR', 1_000, ctx);
    expect(war.ok).toBe(true);
    if (!war.ok) return;

    const depotId = state.meta.nextEntityId++;
    const depotRow = insertRow(state.entities, depotId, 1_010);
    state.entities.cols.kind[depotRow] = ENTITY_KIND.supplyDepot;
    state.entities.cols.owner[depotRow] = 1;
    state.entities.cols.hp[depotRow] = 100;
    placeSpawnedEntity(state.entities, depotRow, 7, 1, 1_010);

    handleBuildingDestruction(state, depotRow, depotId, 100, 1_050, { attackerOwner: 0, ctx });
    const ended = events.find((e) => e.kind === 'warEnded' && e.data.warId === war.war.warId);
    expect(ended?.data.reason).toBe('objective_met');
    expect(ended?.data.slashedToDefender).toBe(false);
    expect(readDiplomacyBlob(state).wars[war.war.warId]?.status).toBe('completed');

    expect(() => WarDeclaredDataSchema.parse(events.find((e) => e.kind === 'warDeclared')!.data)).not.toThrow();
    expect(() => WarEndedDataSchema.parse(ended!.data)).not.toThrow();
  });

  it('slashes attacker war bond on attacker elimination and refunds on defender elimination with strict schema compliance', () => {
    const { state, events, ctx } = makeDiplomacyPlanet();
    markColonyContact(state, 1, 2, 1_000);
    const warAtk = declareWar(state, 0, 1, 5, 'NEAR', 1_000, ctx);
    const warDef = declareWar(state, 2, 0, 5, 'NEAR', 1_000, ctx);
    expect(warAtk.ok && warDef.ok).toBe(true);
    if (!warAtk.ok || !warDef.ok) return;

    cancelColonyTrucesOnElimination(state, 0, 1_200, ctx);
    const atkEnded = events.find((e) => e.kind === 'warEnded' && e.data.warId === warAtk.war.warId);
    const defEnded = events.find((e) => e.kind === 'warEnded' && e.data.warId === warDef.war.warId);
    expect(atkEnded?.data.reason).toBe('eliminated');
    expect(atkEnded?.data.slashedToDefender).toBe(true);
    expect(defEnded?.data.reason).toBe('objective_met');
    expect(defEnded?.data.slashedToDefender).toBe(false);

    for (const ev of events.filter((e) => e.kind === 'warDeclared')) {
      expect(() => WarDeclaredDataSchema.parse(ev.data)).not.toThrow();
    }
    for (const ev of events.filter((e) => e.kind === 'warEnded')) {
      expect(() => WarEndedDataSchema.parse(ev.data)).not.toThrow();
    }
  });
});

describe('War Bond 2x siphon carry cap and AW-13 AI guardrails', () => {
  it('doubles unit siphon carry cap from 40 to 80 during an active war and tracks siphon objective', () => {
    const { state, events, ctx } = makeDiplomacyPlanet();
    const col0 = ensureColonyLedger(state.colonies[0]!);
    const col1 = ensureColonyLedger(state.colonies[1]!);
    col0.caps.metals = 500;
    col0.caps.minerals = 500;
    col0.caps.bio = 500;
    creditResource(state.colonies[1]!, 'metals.t1', 300, 1_000, { produced: false });
    creditResource(state.colonies[1]!, 'minerals.t1', 300, 1_000, { produced: false });
    creditResource(state.colonies[1]!, 'bio.water', 300, 1_000, { produced: false });
    expect(col1.stock['metals.t1']).toBe(300);

    const depotRow = insertRow(state.entities, state.meta.nextEntityId++, 1_000);
    state.entities.cols.kind[depotRow] = ENTITY_KIND.supplyDepot;
    state.entities.cols.owner[depotRow] = 1;
    state.entities.cols.hp[depotRow] = 200;
    state.entities.cols.state[depotRow] = ENTITY_STATE.idle;
    placeSpawnedEntity(state.entities, depotRow, 10, 0, 1_000);

    const reconId = state.meta.nextEntityId++;
    const reconRow = insertRow(state.entities, reconId, 1_000);
    state.entities.cols.kind[reconRow] = ENTITY_KIND.recon;
    state.entities.cols.owner[reconRow] = 0;
    state.entities.cols.hp[reconRow] = 100;
    state.entities.cols.state[reconRow] = ENTITY_STATE.idle;
    placeSpawnedEntity(state.entities, reconRow, 9, 0, 1_000);

    const war = declareWar(state, 0, 1, 5, 'NEAR', 1_000, ctx);
    expect(war.ok).toBe(true);

    (ctx as { dt: number }).dt = 400;
    stepRaidSiphon(state, ctx);
    expect(getUnitSiphonedAmount(state, 0, reconId, 'metals.t1')).toBe(80);
    const ended = events.find((e) => e.kind === 'warEnded');
    expect(ended?.data.reason).toBe('objective_met');
  });

  it('blocks AI from cancelWar and from locking human NEAR in truce or war escrows (AW-13)', () => {
    const { state, ctx } = makeDiplomacyPlanet();
    expect(checkAiCancelTrucePolicy({ kind: 'diplomacy.cancelWar', source: 'ai', args: { warId: 'war_1' } }, state))
      .toEqual({ code: 'away_policy', detail: 'AW-13' });
    expect(checkAiCancelTrucePolicy({ kind: 'diplomacy.declareWar', source: 'ai', args: { targetColonyId: 1, bondAmount: 5, bondToken: 'NEAR' } }, state))
      .toEqual({ code: 'away_policy', detail: 'AW-13' });
    expect(checkAiCancelTrucePolicy({ kind: 'diplomacy.proposeTruce', source: 'ai', args: { targetColonyId: 1, hours: 6, bondAmount: 5, bondToken: 'NEAR' } }, state))
      .toEqual({ code: 'away_policy', detail: 'AW-13' });

    const humanNearOffer = proposeTruce(state, 0, 1, 6, 1_000, ctx, { bondToken: 'NEAR', bondAmount: 5 });
    expect(humanNearOffer.ok).toBe(true);
    if (!humanNearOffer.ok) return;
    expect(checkAiCancelTrucePolicy({ kind: 'diplomacy.respondTruce', source: 'ai', args: { offerId: humanNearOffer.offer.offerId, accept: true } }, state))
      .toEqual({ code: 'away_policy', detail: 'AW-13' });
  });
});
