import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  DiplomacyStateSchema,
  EVENT_KINDS,
  REJECT_CODES,
  TRUCE_DURATIONS_HOURS,
  TruceOfferSchema,
  TruceStateSchema,
  WaveId,
  cancelTruce,
  colonyCritical,
  colonyEliminated,
  commandDef,
  commandGate,
  eventDef,
  parseCommandArgs,
  parseWaves,
  precheckClientCommand,
  proposeTruce,
  raid,
  raidRepelled,
  raidStarted,
  respondTruce,
  truceEnded,
  truceNotice,
  truceOffered,
  truceSigned,
  type CommandKind,
  type EventKind,
  type RejectCode,
} from '../src';

describe('W18-01 wave flag & command gating', () => {
  it('supports W18 wave flag in parseWaves and gates W18 commands under TA_WAVES=..17', () => {
    expect(WaveId.safeParse('W18').success).toBe(true);
    const w17 = parseWaves('..17');
    const w18 = parseWaves('..18');
    expect(w17.has('W18')).toBe(false);
    expect(w18.has('W18')).toBe(true);

    expect(commandGate('raid', w17)).toBe('wave_disabled');
    expect(commandGate('diplomacy.proposeTruce', w17)).toBe('wave_disabled');
    expect(commandGate('diplomacy.respondTruce', w17)).toBe('wave_disabled');
    expect(commandGate('diplomacy.cancelTruce', w17)).toBe('wave_disabled');
    expect(commandGate('raid', w18)).toBeNull();
    expect(commandGate('diplomacy.proposeTruce', w18)).toBeNull();

    const preRaidOff = precheckClientCommand(
      'raid',
      { targetColonyId: 1 },
      { gate: (k) => commandGate(k, w17), production: false, hasColony: true },
    );
    expect(preRaidOff).toEqual({ ok: false, code: 'wave_disabled' });

    const preEnqueueRaidOff = precheckClientCommand(
      'enqueueTask',
      { raid: { targetColonyId: 1 } },
      { gate: (k) => commandGate(k, w17), production: false, hasColony: true },
    );
    expect(preEnqueueRaidOff).toEqual({ ok: false, code: 'wave_disabled' });

    const preEnqueueDirectRaidOff = precheckClientCommand(
      'enqueueTask',
      { task: { kind: 'raid', targetColonyId: 1 } },
      { gate: (k) => commandGate(k, w17), production: false, hasColony: true },
    );
    expect(preEnqueueDirectRaidOff).toEqual({ ok: false, code: 'wave_disabled' });

    const preEnqueueRaidOn = precheckClientCommand(
      'enqueueTask',
      { raid: { targetColonyId: 1 } },
      { gate: (k) => commandGate(k, w18), production: false, hasColony: true },
    );
    expect(preEnqueueRaidOn.ok).toBe(true);
  });
});

describe('W18-01 commands & strict args', () => {
  it('registers all W18 commands with wave W18 and validates strict args', () => {
    const required: CommandKind[] = [
      'raid',
      'diplomacy.proposeTruce',
      'diplomacy.respondTruce',
      'diplomacy.cancelTruce',
      'dev.killHq',
      'dev.killHub',
      'dev.setShield',
      'dev.offerTruce',
    ];
    for (const k of required) {
      expect(COMMAND_KINDS).toContain(k);
      expect(commandDef(k).wave).toBe('W18');
    }

    expect(raid.kind).toBe('raid');
    expect(proposeTruce.kind).toBe('diplomacy.proposeTruce');
    expect(respondTruce.kind).toBe('diplomacy.respondTruce');
    expect(cancelTruce.kind).toBe('diplomacy.cancelTruce');
    expect(TRUCE_DURATIONS_HOURS).toEqual([2, 6, 24, 72]);

    expect(parseCommandArgs('raid', { targetColonyId: 1 }).success).toBe(true);
    expect(parseCommandArgs('raid', { targetColonyId: 'col_1', unitIds: [10, 11] }).success).toBe(true);
    expect(parseCommandArgs('raid', {}).success).toBe(false);
    expect(parseCommandArgs('raid', { targetColonyId: 1, extra: true }).success).toBe(false);

    expect(parseCommandArgs('enqueueTask', { raid: { targetColonyId: 1, unitIds: [3, 4] } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { task: { kind: 'raid', targetColonyId: 2 } }).success).toBe(true);
    expect(parseCommandArgs('enqueueTask', { raid: {} }).success).toBe(false);

    for (const hours of [2, 6, 24, 72] as const) {
      expect(parseCommandArgs('diplomacy.proposeTruce', { targetColonyId: 1, hours }).success).toBe(true);
    }
    expect(parseCommandArgs('diplomacy.proposeTruce', { targetColonyId: 'col_2', hours: 6 }).success).toBe(true);
    expect(parseCommandArgs('diplomacy.proposeTruce', { targetColonyId: 1, hours: 12 }).success).toBe(false);
    expect(parseCommandArgs('diplomacy.proposeTruce', { hours: 6 }).success).toBe(false);
    expect(parseCommandArgs('diplomacy.proposeTruce', { targetColonyId: 1, hours: 6, unknown: 1 }).success).toBe(false);

    expect(parseCommandArgs('diplomacy.respondTruce', { offerId: 'offer_1', accept: true }).success).toBe(true);
    expect(parseCommandArgs('diplomacy.respondTruce', { offerId: 'offer_1', accept: false }).success).toBe(true);
    expect(parseCommandArgs('diplomacy.respondTruce', { offerId: '', accept: true }).success).toBe(false);
    expect(parseCommandArgs('diplomacy.respondTruce', { offerId: 'offer_1' }).success).toBe(false);

    expect(parseCommandArgs('diplomacy.cancelTruce', { truceId: 'truce_1' }).success).toBe(true);
    expect(parseCommandArgs('diplomacy.cancelTruce', { truceId: '' }).success).toBe(false);
    expect(parseCommandArgs('diplomacy.cancelTruce', { truceId: 'truce_1', extra: 1 }).success).toBe(false);
  });
});

describe('W18-01 events, reject codes & truce schemas', () => {
  it('registers W18 diplomacy events and validates strict payloads', () => {
    const w18Events: EventKind[] = ['truceOffered', 'truceSigned', 'truceNotice', 'truceEnded'];
    for (const k of w18Events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W18');
    }

    expect(truceOffered.data.safeParse({ offerId: 'of_1', fromColony: 0, toColony: 1, hours: 6 }).success).toBe(true);
    expect(truceOffered.data.safeParse({ offerId: 'of_1', hours: 5 }).success).toBe(false);

    expect(truceSigned.data.safeParse({ truceId: 'tr_1', colonyA: 0, colonyB: 1, hours: 24, expiresAtTick: 432000 }).success).toBe(true);
    expect(truceSigned.data.safeParse({ colonyId: 'col_0' }).success).toBe(true);

    expect(truceNotice.data.safeParse({ truceId: 'tr_1', cancelledBy: 0, noticeEndsAtTick: 3500 }).success).toBe(true);
    expect(truceNotice.data.safeParse({ truceId: 'tr_1' }).success).toBe(false);

    expect(truceEnded.data.safeParse({ truceId: 'tr_1', reason: 'expired' }).success).toBe(true);
    expect(truceEnded.data.safeParse({ truceId: 'tr_1', reason: 'cancelled', cancelledBy: 0, oathbreakerUntilTick: 435500 }).success).toBe(true);
    expect(truceEnded.data.safeParse({ truceId: 'tr_1', reason: 'invalid' }).success).toBe(false);

    expect(raidStarted.data.safeParse({ raidId: 'rd_1', attackerColony: 0, targetColony: 1, count: 4, q: 12, r: -4 }).success).toBe(true);
    expect(raidRepelled.data.safeParse({ raidId: 'rd_1', attackerColony: 0, targetColony: 1, unbreached: false, siphoned: { 'metals.t1': 20 } }).success).toBe(true);
    expect(colonyCritical.data.safeParse({ colonyId: 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV', atTick: 100, cause: 'hub_destroyed' }).success).toBe(true);
    expect(colonyEliminated.data.safeParse({ colonyId: 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV', atTick: 3100, cause: 'both_lost' }).success).toBe(true);
  });

  it('includes W18 reject codes and validates TruceOfferSchema / TruceStateSchema / DiplomacyStateSchema', () => {
    const codes: RejectCode[] = [
      'raid_protected',
      'truce_active',
      'recent_hostility',
      'oathbreaker',
      'cross_sector_disabled',
      'no_contact',
      'truce_cap',
      'unknown_offer',
      'unknown_truce',
    ];
    for (const c of codes) {
      expect(REJECT_CODES).toContain(c);
    }

    const offer = {
      offerId: 'offer_0_1_100',
      fromColony: 0,
      toColony: 1,
      hours: 6 as const,
      offeredAtTick: 100,
      expiresAtTick: 3100,
      status: 'pending' as const,
    };
    const truce = {
      truceId: 'truce_0_1_120',
      colonyA: 0,
      colonyB: 1,
      hours: 6 as const,
      signedAtTick: 120,
      expiresAtTick: 108120,
      status: 'active' as const,
    };
    expect(TruceOfferSchema.safeParse(offer).success).toBe(true);
    expect(TruceStateSchema.safeParse(truce).success).toBe(true);
    expect(
      DiplomacyStateSchema.safeParse({
        offers: [offer],
        truces: [truce],
        oathbreakerUntilByColony: { '0': 500000 },
        lastHostilityAtByPair: { '0:1': 50 },
      }).success,
    ).toBe(true);
  });
});
