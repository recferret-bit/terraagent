import { describe, expect, it } from 'vitest';
import { W11_DEFAULT_SECTOR_RADIUS } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, setField } from '../../ecs/store';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState } from '../../kernel/state';
import {
  markColonyOathbreaker,
  writeDiplomacyBlob,
  type DiplomacyBlobValue,
  type StoredTruceRecord,
} from '../diplomacy/store';
import {
  dropColonyShield,
  initColonyNewcomerShield,
  setColonyShieldHours,
} from '../pvp/shield';
import { getPvpState, savePvpState } from '../pvp/store';
import {
  checkDirectorActionPermission,
  computeColonyPvpThreatScore,
  evaluateAggressionSkillProposal,
} from './index';

describe('W18-32 checkDirectorActionPermission — wave fencing & truce cancel', () => {
  it('enforces W18 wave fencing for AI raid and truce commands', () => {
    const wavesNoW18 = new Set(['W00', 'W08', 'W16']);
    const wavesWithW18 = new Set(['W00', 'W08', 'W16', 'W18']);

    const raidAction = { kind: 'raid', args: { targetColonyId: 'col_1' } };
    const proposeAction = { kind: 'diplomacy.proposeTruce', args: { targetColonyId: 'col_1', hours: 6 } };
    const respondAction = { kind: 'diplomacy.respondTruce', args: { offerId: 'off_1', accept: true } };
    const nonPvpAction = { kind: 'queueGoal', args: { goal: 'establish_colony' } };

    expect(checkDirectorActionPermission({ action: raidAction, waves: wavesNoW18 })).toEqual({
      ok: false,
      code: 'wave_disabled',
      reason: 'W18 is disabled',
    });
    expect(checkDirectorActionPermission({ action: proposeAction, waves: wavesNoW18 })).toEqual({
      ok: false,
      code: 'wave_disabled',
      reason: 'W18 is disabled',
    });
    expect(checkDirectorActionPermission({ action: respondAction, waves: wavesNoW18 })).toEqual({
      ok: false,
      code: 'wave_disabled',
      reason: 'W18 is disabled',
    });
    expect(checkDirectorActionPermission({ action: nonPvpAction, waves: wavesNoW18 })).toEqual({
      ok: true,
    });

    const raidAllowed = checkDirectorActionPermission({
      action: raidAction,
      waves: wavesWithW18,
      awayRaids: true,
    });
    expect(raidAllowed.ok).toBe(true);
  });

  it('rejects cancelTruce directives: AI/director may never cancel an active truce (AW-13, UO-DIP-05)', () => {
    const cancel1 = checkDirectorActionPermission({
      action: { kind: 'diplomacy.cancelTruce', args: { truceId: 'truce_1' } },
    });
    expect(cancel1).toEqual({
      ok: false,
      code: 'away_policy',
      rule: 'AW-13',
      reason: 'AI director may never cancel a truce',
    });

    const cancel2 = checkDirectorActionPermission({
      action: { kind: 'cancelTruce', args: { truceId: 'truce_2' } },
    });
    expect(cancel2).toEqual({
      ok: false,
      code: 'away_policy',
      rule: 'AW-13',
      reason: 'AI director may never cancel a truce',
    });
  });
});

describe('W18-32 checkDirectorActionPermission — away policy & permissions', () => {
  it('enforces awayRaids opt-in and strategy permissions for raid directives (AW-11)', () => {
    const action = { kind: 'raid', args: { targetColonyId: 'col_1' } };

    expect(checkDirectorActionPermission({ action, away: true, awayRaids: false })).toEqual({
      ok: false,
      code: 'away_policy',
      rule: 'AW-11',
      reason: 'awayRaids is disabled',
    });

    expect(
      checkDirectorActionPermission({
        action,
        permissions: { raids: false, upgrades: true, launch: true },
      }),
    ).toEqual({
      ok: false,
      code: 'away_policy',
      rule: 'AW-11',
      reason: 'awayRaids is disabled',
    });

    expect(
      checkDirectorActionPermission({
        action,
        away: false,
        permissions: { raids: false, upgrades: true, launch: true },
      }),
    ).toEqual({
      ok: false,
      code: 'away_policy',
      rule: 'AW-11',
      reason: 'raid strategy permission disabled',
    });

    expect(checkDirectorActionPermission({ action, away: true, awayRaids: true })).toEqual({
      ok: true,
      skillId: 'diplomacy',
    });
  });
});

function createTargetValidationPlanet() {
  const state = createState({
    planetId: 'pl_w18_dir_unit',
    planetType: 'temperate',
    seed: 'w18-dir-seed',
    radius: W11_DEFAULT_SECTOR_RADIUS,
  });
  const col0 = ensureColonyRecord(state, 0, 0);
  col0.foundingSectorId = 'sec_0_0';
  col0.status = 'active';

  const col1 = ensureColonyRecord(state, 1, 0);
  col1.foundingSectorId = 'sec_0_0';
  col1.status = 'active';

  const col2 = ensureColonyRecord(state, 2, 0);
  col2.foundingSectorId = 'sec_1_0';
  col2.status = 'active';

  return state;
}

describe('W18-32 checkDirectorActionPermission — target validation self and cross-sector', () => {
  it('rejects self, unknown, and cross-sector raid targets', () => {
    const state = createTargetValidationPlanet();

    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_0' } },
        state,
        colonyIndex: 0,
        awayRaids: true,
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_target',
      reason: 'Invalid raid target colony',
    });

    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_99' } },
        state,
        colonyIndex: 0,
        awayRaids: true,
      }),
    ).toEqual({
      ok: false,
      code: 'invalid_target',
      reason: 'Invalid raid target colony',
    });

    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_2' } },
        state,
        colonyIndex: 0,
        awayRaids: true,
      }),
    ).toEqual({
      ok: false,
      code: 'cross_sector_disabled',
      reason: 'Cross-sector raids are disabled',
    });
  });
});

describe('W18-32 checkDirectorActionPermission — target validation shield and truce', () => {
  it('rejects shielded neighbor and active truce partner', () => {
    const state = createTargetValidationPlanet();

    setColonyShieldHours(state, 1, 6, 0);
    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_1' } },
        state,
        colonyIndex: 0,
        awayRaids: true,
        tick: 10,
      }),
    ).toEqual({
      ok: false,
      code: 'raid_protected',
      reason: 'Target colony has newcomer shield',
    });

    dropColonyShield(state, 1, 20);
    const truceRecord: StoredTruceRecord = {
      truceId: 'truce_0_1',
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
      expiresAtTick: 50_000,
      status: 'active',
    };
    writeDiplomacyBlob(state, {
      nextOfferSeq: 1,
      nextTruceSeq: 2,
      offers: {},
      truces: { truce_0_1: truceRecord },
      oathbreakerUntilByColony: {},
      lastHostilityByPair: {},
      contactsByColony: {},
      noContactByColony: {},
    }, 20);

    expect(
      checkDirectorActionPermission({
        action: { kind: 'raid', args: { targetColonyId: 'col_1' } },
        state,
        colonyIndex: 0,
        awayRaids: true,
        tick: 20,
      }),
    ).toEqual({
      ok: false,
      code: 'truce_active',
      reason: 'Active truce with target colony',
    });
  });
});

describe('W18-32 checkDirectorActionPermission — target validation success', () => {
  it('permits raid on valid target across all command wire shapes', () => {
    const state = createTargetValidationPlanet();
    dropColonyShield(state, 1, 0);

    const shapes = [
      { kind: 'raid', args: { targetColonyId: 'col_1' } },
      { kind: 'enqueueTask', args: { raid: { targetColonyId: 'col_1' } } },
      { kind: 'queueGoal', args: { goal: 'raid_target', params: { targetColonyId: 'col_1' } } },
    ];
    for (const action of shapes) {
      expect(
        checkDirectorActionPermission({
          action,
          state,
          colonyIndex: 0,
          awayRaids: true,
          tick: 60_000,
        }),
      ).toEqual({ ok: true, skillId: 'diplomacy' });
    }
  });
});

describe('W18-32 checkDirectorActionPermission — truce propose & respond', () => {
  it('validates truce propose and respond with duration bounds and oathbreaker mark', () => {
    const state = createState({
      planetId: 'pl_w18_dir_dip',
      planetType: 'temperate',
      seed: 'w18-dip-seed',
      radius: 20,
    });
    ensureColonyRecord(state, 0, 0);

    expect(
      checkDirectorActionPermission({
        action: { kind: 'diplomacy.proposeTruce', args: { targetColonyId: 'col_1', hours: 5 } },
      }),
    ).toEqual({
      ok: false,
      code: 'away_policy',
      rule: 'AW-13',
      reason: 'Invalid diplomacy parameters',
    });

    expect(
      checkDirectorActionPermission({
        action: { kind: 'diplomacy.proposeTruce', args: { targetColonyId: 'col_1', hours: 6 } },
      }),
    ).toEqual({ ok: true, skillId: 'diplomacy' });

    expect(
      checkDirectorActionPermission({
        action: { kind: 'diplomacy.respondTruce', args: { offerId: 'off_42', accept: true } },
      }),
    ).toEqual({ ok: true, skillId: 'diplomacy' });

    markColonyOathbreaker(state, 0, 10_000, 0);
    expect(
      checkDirectorActionPermission({
        action: { kind: 'diplomacy.proposeTruce', args: { targetColonyId: 'col_1', hours: 6 } },
        state,
        colonyIndex: 0,
        tick: 5_000,
      }),
    ).toEqual({
      ok: false,
      code: 'oathbreaker',
      reason: 'Colony has Oathbreaker mark',
    });
  });
});

describe('W18-32 evaluateAggressionSkillProposal — candidate selection', () => {
  it('evaluates aggression skill proposals and handles boundary tick of shield expiry', () => {
    const state = createState({
      planetId: 'pl_w18_aggr',
      planetType: 'temperate',
      seed: 'w18-aggr-seed',
      radius: W11_DEFAULT_SECTOR_RADIUS,
    });
    const col0 = ensureColonyRecord(state, 0, 0);
    col0.foundingSectorId = 'sec_0_0';
    col0.status = 'active';

    const col1 = ensureColonyRecord(state, 1, 0);
    col1.foundingSectorId = 'sec_0_0';
    col1.status = 'active';

    const col2 = ensureColonyRecord(state, 2, 0);
    col2.foundingSectorId = 'sec_0_0';
    col2.status = 'eliminated';

    initColonyNewcomerShield(state, 1, 0);
    const pvp = getPvpState(state);
    pvp.byColony['1']!.raidProtectedUntil = 1000;
    savePvpState(state, pvp, 0);

    const before = evaluateAggressionSkillProposal(state, 0, {
      awayRaids: true,
      tick: 999,
    });
    expect(before).toEqual({
      ok: true,
      eligibleTargets: [],
      recommendedTargetColony: null,
    });

    const after = evaluateAggressionSkillProposal(state, 0, {
      awayRaids: true,
      tick: 1000,
    });
    expect(after).toEqual({
      ok: true,
      eligibleTargets: [1],
      recommendedTargetColony: 1,
    });
  });
});

describe('W18-32 computeColonyPvpThreatScore — scoring rules & clamping', () => {
  it('computes colony threat score factoring in incoming raids, hostile units, shields, and critical status', () => {
    const state = createState({
      planetId: 'pl_w18_threat',
      planetType: 'temperate',
      seed: 'w18-threat-seed',
      radius: 20,
    });
    const col0 = ensureColonyRecord(state, 0, 0);
    col0.status = 'active';
    ensureColonyRecord(state, 1, 0).status = 'active';

    const hqRow = insertRow(state.entities, 101, 0);
    placeSpawnedEntity(state.entities, hqRow, 0, 0, 0);
    setField(state.entities, hqRow, 'owner', 0, 0);
    setField(state.entities, hqRow, 'kind', ENTITY_KIND.hq, 0);
    setField(state.entities, hqRow, 'hp', 1000, 0);
    setField(state.entities, hqRow, 'state', ENTITY_STATE.active, 0);
    dropColonyShield(state, 0, 0);

    expect(computeColonyPvpThreatScore(state, 0, 0)).toBe(0);

    const pvp = getPvpState(state);
    pvp.activeRaids['raid_1'] = {
      raidId: 'raid_1',
      attackerColony: 1,
      targetColony: 0,
      startedAtTick: 0,
      unitIds: [201],
      groupId: 1,
      currentTargetEntityId: null,
      currentTargetQ: 0,
      currentTargetR: 0,
      repelled: false,
    };
    savePvpState(state, pvp, 0);
    expect(computeColonyPvpThreatScore(state, 0, 0)).toBe(50);

    const u1Row = insertRow(state.entities, 201, 0);
    placeSpawnedEntity(state.entities, u1Row, 2, 2, 0);
    setField(state.entities, u1Row, 'owner', 1, 0);
    setField(state.entities, u1Row, 'kind', ENTITY_KIND.recon, 0);
    setField(state.entities, u1Row, 'hp', 100, 0);
    setField(state.entities, u1Row, 'state', ENTITY_STATE.active, 0);
    expect(computeColonyPvpThreatScore(state, 0, 0)).toBe(65);

    setColonyShieldHours(state, 0, 6, 0);
    expect(computeColonyPvpThreatScore(state, 0, 0)).toBe(40);

    col0.status = 'critical';
    expect(computeColonyPvpThreatScore(state, 0, 0)).toBe(100);

    col0.status = 'active';
    delete pvp.activeRaids['raid_1'];
    savePvpState(state, pvp, 0);
    setField(state.entities, u1Row, 'hp', 0, 0);
    expect(computeColonyPvpThreatScore(state, 0, 0)).toBe(0);
  });
});
