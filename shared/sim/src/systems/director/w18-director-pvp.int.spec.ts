import { describe, expect, it } from 'vitest';
import { parseWaves, W11_DEFAULT_SECTOR_RADIUS } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  setField,
  SimHost,
} from '../../index';
import {
  writeDiplomacyBlob,
  type DiplomacyBlobValue,
  type StoredTruceRecord,
} from '../diplomacy/store';
import {
  dropColonyShield,
  initColonyNewcomerShield,
  isColonyRaidProtected,
  setColonyShieldHours,
} from '../pvp/shield';
import { getPvpState, savePvpState } from '../pvp/store';
import {
  buildSectorAdvisorBrief,
  checkDirectorActionPermission,
  computeColonyPvpThreatScore,
  evaluateAggressionSkillProposal,
} from './index';

function setupMultiColonySim(): SimHost {
  const sim = new SimHost({ flags: parseWaves('..18') });
  sim.load(createPlanet({ type: 'flat', seed: 'w18-32-int-multi', radius: W11_DEFAULT_SECTOR_RADIUS }));

  const col0 = ensureColonyRecord(sim.state, 0, 0);
  col0.status = 'active';
  col0.stage = 4;
  col0.foundingSectorId = 'sec_0_0';
  dropColonyShield(sim.state, 0, 0);

  const col1 = ensureColonyRecord(sim.state, 1, 0);
  col1.status = 'active';
  col1.stage = 4;
  col1.foundingSectorId = 'sec_0_0';
  dropColonyShield(sim.state, 1, 0);

  const col2 = ensureColonyRecord(sim.state, 2, 0);
  col2.status = 'active';
  col2.stage = 2;
  col2.foundingSectorId = 'sec_0_0';
  initColonyNewcomerShield(sim.state, 2, 0);

  const col3 = ensureColonyRecord(sim.state, 3, 0);
  col3.status = 'active';
  col3.stage = 4;
  col3.foundingSectorId = 'sec_1_0';
  dropColonyShield(sim.state, 3, 0);

  return sim;
}

describe('W18-32 SimHost integration — aggression skill and action permissions', () => {
  it('positive: evaluates aggression proposal and permits raid and truce on eligible neighbor', () => {
    const sim = setupMultiColonySim();

    const proposal = evaluateAggressionSkillProposal(sim.state, 0, {
      awayRaids: true,
      waves: parseWaves('..18'),
      tick: 100,
    });
    expect(proposal).toEqual({
      ok: true,
      eligibleTargets: [1],
      recommendedTargetColony: 1,
    });

    const raidCheck = checkDirectorActionPermission({
      action: { kind: 'raid', args: { targetColonyId: 'col_1' } },
      state: sim.state,
      colonyIndex: 0,
      awayRaids: true,
      waves: parseWaves('..18'),
      tick: 100,
    });
    expect(raidCheck).toEqual({ ok: true, skillId: 'diplomacy' });

    const proposeCheck = checkDirectorActionPermission({
      action: { kind: 'diplomacy.proposeTruce', args: { targetColonyId: 'col_1', hours: 6 } },
      state: sim.state,
      colonyIndex: 0,
      waves: parseWaves('..18'),
      tick: 100,
    });
    expect(proposeCheck).toEqual({ ok: true, skillId: 'diplomacy' });

    const respondCheck = checkDirectorActionPermission({
      action: { kind: 'diplomacy.respondTruce', args: { offerId: 'offer_101', accept: true } },
      waves: parseWaves('..18'),
    });
    expect(respondCheck).toEqual({ ok: true, skillId: 'diplomacy' });
  });

  it('negative: rejects shielded, cross-sector, away-denied, cancel, and wave-disabled actions', () => {
    const sim = setupMultiColonySim();

    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_2' } },
        state: sim.state,
        colonyIndex: 0,
        awayRaids: true,
        waves: parseWaves('..18'),
        tick: 100,
      }),
    ).toEqual({ ok: false, code: 'raid_protected', reason: 'Target colony has newcomer shield' });

    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_3' } },
        state: sim.state,
        colonyIndex: 0,
        awayRaids: true,
        waves: parseWaves('..18'),
        tick: 100,
      }),
    ).toEqual({ ok: false, code: 'cross_sector_disabled', reason: 'Cross-sector raids are disabled' });

    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_1' } },
        state: sim.state,
        colonyIndex: 0,
        away: true,
        awayRaids: false,
      }),
    ).toEqual({ ok: false, code: 'away_policy', rule: 'AW-11', reason: 'awayRaids is disabled' });

    expect(
      checkDirectorActionPermission({
        action: { kind: 'diplomacy.cancelTruce', args: { truceId: 'truce_1' } },
      }),
    ).toEqual({ ok: false, code: 'away_policy', rule: 'AW-13', reason: 'AI director may never cancel a truce' });

    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_1' } },
        waves: parseWaves('..16'),
      }),
    ).toEqual({ ok: false, code: 'wave_disabled', reason: 'W18 is disabled' });
  });
});

describe('W18-32 SimHost integration — SectorAdvisorBrief threat & diplomacy', () => {
  it('populates SectorAdvisorBrief with PvP threat scores and auto-projected diplomacy state', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    sim.load(createPlanet({ type: 'flat', seed: 'w18-32-brief-test', radius: 24 }));

    const col0 = ensureColonyRecord(sim.state, 0, 0);
    col0.status = 'active';
    col0.stage = 3;
    const col1 = ensureColonyRecord(sim.state, 1, 0);
    col1.status = 'active';
    col1.stage = 3;

    const hubId = sim.state.meta.nextEntityId++;
    const hRow = insertRow(sim.state.entities, hubId, 0);
    placeSpawnedEntity(sim.state.entities, hRow, 0, 0, 0);
    setField(sim.state.entities, hRow, 'owner', 0, 0);
    setField(sim.state.entities, hRow, 'kind', ENTITY_KIND.commandHub, 0);
    setField(sim.state.entities, hRow, 'hp', 1200, 0);
    setField(sim.state.entities, hRow, 'state', ENTITY_STATE.active, 0);

    const reconId = sim.state.meta.nextEntityId++;
    const rRow = insertRow(sim.state.entities, reconId, 0);
    placeSpawnedEntity(sim.state.entities, rRow, 3, 2, 0);
    setField(sim.state.entities, rRow, 'owner', 1, 0);
    setField(sim.state.entities, rRow, 'kind', ENTITY_KIND.recon, 0);
    setField(sim.state.entities, rRow, 'hp', 80, 0);
    setField(sim.state.entities, rRow, 'state', ENTITY_STATE.active, 0);

    const pvp = getPvpState(sim.state);
    pvp.activeRaids['raid_test'] = {
      raidId: 'raid_test',
      attackerColony: 1,
      targetColony: 0,
      startedAtTick: 0,
      unitIds: [reconId],
      groupId: 1,
      currentTargetEntityId: null,
      currentTargetQ: 0,
      currentTargetR: 0,
      repelled: false,
    };
    savePvpState(sim.state, pvp, 0);

    dropColonyShield(sim.state, 0, 0);
    expect(computeColonyPvpThreatScore(sim.state, 0, 0)).toBe(65);

    const truceRecord: StoredTruceRecord = {
      truceId: 'truce_test',
      colonyA: 0,
      colonyB: 1,
      colonyAId: 'col_0',
      colonyBId: 'col_1',
      colonyAIndex: 0,
      colonyBIndex: 1,
      hours: 6,
      durationHours: 6,
      signedAtTick: 0,
      startedAtTick: 0,
      expiresAtTick: 100_000,
      status: 'active',
    };
    const dipBlob: DiplomacyBlobValue = {
      nextOfferSeq: 1,
      nextTruceSeq: 2,
      offers: {},
      truces: { truce_test: truceRecord },
      oathbreakerUntilByColony: {},
      lastHostilityByPair: {},
      contactsByColony: { 0: [1], 1: [0] },
      noContactByColony: {},
    };
    writeDiplomacyBlob(sim.state, dipBlob, 0);

    const brief = buildSectorAdvisorBrief(sim.state, 'sector_alpha', 300, 300);
    const col0Snap = brief.colonies.find((c) => c.colonyId === 'col_0');
    expect(col0Snap).toBeDefined();
    expect(col0Snap!.threatScore).toBe(50);

    expect(brief.diplomacy.length).toBeGreaterThan(0);
    const snap = brief.diplomacy.find(
      (d) =>
        (d.colonyPair[0] === 'col_0' && d.colonyPair[1] === 'col_1') ||
        (d.colonyPair[0] === 'col_1' && d.colonyPair[1] === 'col_0'),
    );
    expect(snap).toBeDefined();
    expect(snap!.relation).toBe('truce');
  });
});

describe('W18-32 SimHost integration — boundary conditions and critical colony', () => {
  it('handles corner cases: critical colony threat 100 and shield expiry boundary', () => {
    const sim = new SimHost({ flags: parseWaves('..18') });
    sim.load(createPlanet({ type: 'flat', seed: 'w18-32-corner', radius: W11_DEFAULT_SECTOR_RADIUS }));

    const col0 = ensureColonyRecord(sim.state, 0, 0);
    col0.status = 'active';
    col0.foundingSectorId = 'sec_0_0';
    dropColonyShield(sim.state, 0, 0);

    const col1 = ensureColonyRecord(sim.state, 1, 0);
    col1.status = 'active';
    col1.foundingSectorId = 'sec_0_0';

    setColonyShieldHours(sim.state, 1, 6, 0);
    const pvp = getPvpState(sim.state);
    pvp.byColony['1']!.raidProtectedUntil = 5000;
    savePvpState(sim.state, pvp, 0);

    expect(isColonyRaidProtected(sim.state, 1, 4999)).toBe(true);
    const evalBefore = evaluateAggressionSkillProposal(sim.state, 0, {
      awayRaids: true,
      tick: 4999,
    });
    expect(evalBefore).toEqual({
      ok: true,
      eligibleTargets: [],
      recommendedTargetColony: null,
    });

    expect(isColonyRaidProtected(sim.state, 1, 5000)).toBe(false);
    const evalAfter = evaluateAggressionSkillProposal(sim.state, 0, {
      awayRaids: true,
      tick: 5000,
    });
    expect(evalAfter).toEqual({
      ok: true,
      eligibleTargets: [1],
      recommendedTargetColony: 1,
    });

    col0.status = 'critical';
    expect(computeColonyPvpThreatScore(sim.state, 0, 5000)).toBe(100);
  });
});
