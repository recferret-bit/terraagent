import { describe, expect, it } from 'vitest';
import {
  createPvpTracker,
  PVP_EVENTS,
  PvpTracker,
  type TrackFn,
} from './pvpTracker';

function setupRecorder() {
  const events: Array<{ name: string; props: Record<string, unknown> }> = [];
  const track: TrackFn = (name, props) => {
    events.push({ name, props: props ?? {} });
  };
  const tracker = createPvpTracker(track);
  return { events, tracker };
}

describe('PVP_EVENTS constants and direct raid & elimination', () => {
  it('exposes the exact 4 PVP_EVENTS constants', () => {
    expect(PVP_EVENTS).toEqual([
      'raid_started',
      'colony_eliminated',
      'truce_signed',
      'truce_broken',
    ]);
  });

  it('tracks raidStarted with required and optional props', () => {
    const { events, tracker } = setupRecorder();

    tracker.raidStarted({
      colonyId: 'col_attacker',
      targetColonyId: 'col_defender',
      unitCount: 8,
      planetId: 'planet_tau',
      attackerColonyId: 'col_attacker',
    });

    expect(events).toEqual([
      {
        name: 'raid_started',
        props: {
          colonyId: 'col_attacker',
          targetColonyId: 'col_defender',
          unitCount: 8,
          planetId: 'planet_tau',
          attackerColonyId: 'col_attacker',
        },
      },
    ]);
  });

  it('tracks colonyEliminated with required and optional props', () => {
    const { events, tracker } = setupRecorder();

    tracker.colonyEliminated({
      colonyId: 'col_fallen',
      cause: 'both_lost',
      planetId: 'planet_tau',
      killerColonyId: 'col_victor',
    });

    expect(events).toEqual([
      {
        name: 'colony_eliminated',
        props: {
          colonyId: 'col_fallen',
          cause: 'both_lost',
          planetId: 'planet_tau',
          killerColonyId: 'col_victor',
        },
      },
    ]);
  });
});

describe('PvpTracker direct truce signing and breaking', () => {
  it('tracks truceSigned with durationHours and partner', () => {
    const { events, tracker } = setupRecorder();

    tracker.truceSigned({
      colonyId: 'col_a',
      partnerColonyId: 'col_b',
      durationHours: 24,
      planetId: 'planet_tau',
      truceId: 'tr_100',
    });

    expect(events).toEqual([
      {
        name: 'truce_signed',
        props: {
          colonyId: 'col_a',
          partnerColonyId: 'col_b',
          durationHours: 24,
          planetId: 'planet_tau',
          truceId: 'tr_100',
        },
      },
    ]);
  });

  it('tracks truceBroken with cancel initiator and oathbreaker penalties', () => {
    const { events, tracker } = setupRecorder();

    tracker.truceBroken({
      colonyId: 'col_a',
      byColonyId: 'col_b',
      partnerColonyId: 'col_b',
      truceId: 'tr_100',
      planetId: 'planet_tau',
      oathbreakerHours: 48,
    });

    expect(events).toEqual([
      {
        name: 'truce_broken',
        props: {
          colonyId: 'col_a',
          byColonyId: 'col_b',
          partnerColonyId: 'col_b',
          truceId: 'tr_100',
          planetId: 'planet_tau',
          oathbreakerHours: 48,
        },
      },
    ]);
  });
});

describe('PvpTracker sim combat event mapping', () => {
  it('maps sim raidStarted into raid_started', () => {
    const { events, tracker } = setupRecorder();

    const handled = tracker.handleSimEvent(
      {
        kind: 'raidStarted',
        data: {
          raidId: 'rd_9',
          targetColonyId: 'col_target',
          count: 5,
          attackerColonyId: 'col_own',
        },
      },
      'col_own',
      'planet_test',
    );

    expect(handled).toBe(true);
    expect(events).toEqual([
      {
        name: 'raid_started',
        props: {
          colonyId: 'col_own',
          targetColonyId: 'col_target',
          unitCount: 5,
          planetId: 'planet_test',
          attackerColonyId: 'col_own',
        },
      },
    ]);
  });

  it('maps sim colonyEliminated into colony_eliminated', () => {
    const { events, tracker } = setupRecorder();

    const handled = tracker.handleSimEvent(
      {
        kind: 'colonyEliminated',
        data: {
          colonyId: 'col_target',
          cause: 'timer',
          killerColonyId: 'col_killer',
        },
      },
      'col_target',
      'planet_test',
    );

    expect(handled).toBe(true);
    expect(events).toEqual([
      {
        name: 'colony_eliminated',
        props: {
          colonyId: 'col_target',
          cause: 'critical_timeout',
          planetId: 'planet_test',
          killerColonyId: 'col_killer',
        },
      },
    ]);
  });
});

describe('PvpTracker sim truce event mapping', () => {
  it('maps sim truceSigned into truce_signed', () => {
    const { events, tracker } = setupRecorder();

    const handled = tracker.handleSimEvent(
      {
        kind: 'truceSigned',
        data: {
          truceId: 'tr_alpha',
          colonyAId: 'col_own',
          colonyBId: 'col_partner',
          hours: 72,
        },
      },
      'col_own',
      'planet_test',
    );

    expect(handled).toBe(true);
    expect(events).toEqual([
      {
        name: 'truce_signed',
        props: {
          colonyId: 'col_own',
          partnerColonyId: 'col_partner',
          durationHours: 72,
          planetId: 'planet_test',
          truceId: 'tr_alpha',
        },
      },
    ]);
  });

  it('maps sim truceNotice into truce_broken', () => {
    const { events, tracker } = setupRecorder();

    const handled = tracker.handleSimEvent(
      {
        kind: 'truceNotice',
        data: {
          truceId: 'tr_beta',
          cancelledByColonyId: 'col_traitor',
          colonyAId: 'col_own',
          colonyBId: 'col_traitor',
        },
      },
      'col_own',
      'planet_test',
    );

    expect(handled).toBe(true);
    expect(events).toEqual([
      {
        name: 'truce_broken',
        props: {
          colonyId: 'col_own',
          byColonyId: 'col_traitor',
          partnerColonyId: 'col_own',
          planetId: 'planet_test',
          truceId: 'tr_beta',
        },
      },
    ]);
  });

  it('maps cancelled truceEnded into truce_broken', () => {
    const { events, tracker } = setupRecorder();

    const handled = tracker.handleSimEvent(
      {
        kind: 'truceEnded',
        data: {
          truceId: 'tr_gamma',
          reason: 'cancelled',
          cancelledByColonyId: 'col_traitor',
          oathbreakerHours: 48,
        },
      },
      'col_own',
      'planet_test',
    );

    expect(handled).toBe(true);
    expect(events).toEqual([
      {
        name: 'truce_broken',
        props: {
          colonyId: 'col_own',
          byColonyId: 'col_traitor',
          planetId: 'planet_test',
          truceId: 'tr_gamma',
          oathbreakerHours: 48,
        },
      },
    ]);
  });
});

describe('PvpTracker negative cases', () => {
  it('is a safe no-op when track function is undefined', () => {
    const tracker = createPvpTracker(undefined);
    expect(tracker).toBeInstanceOf(PvpTracker);

    expect(() => {
      tracker.raidStarted({ colonyId: 'c1', targetColonyId: 'c2', unitCount: 1 });
      tracker.colonyEliminated({ colonyId: 'c1', cause: 'abandoned' });
      tracker.truceSigned({ colonyId: 'c1', partnerColonyId: 'c2', durationHours: 6 });
      tracker.truceBroken({ colonyId: 'c1', byColonyId: 'c2' });
      tracker.handleSimEvent({ kind: 'raidStarted', data: { targetColonyId: 'c2', count: 1 } }, 'c1');
    }).not.toThrow();
  });

  it('ignores calls with empty IDs or invalid unitCount', () => {
    const { events, tracker } = setupRecorder();

    tracker.raidStarted({ colonyId: '', targetColonyId: 'c2', unitCount: 1 });
    tracker.raidStarted({ colonyId: 'c1', targetColonyId: '   ', unitCount: 1 });
    tracker.raidStarted({ colonyId: 'c1', targetColonyId: 'c2', unitCount: -5 });
    tracker.raidStarted({ colonyId: 'c1', targetColonyId: 'c2', unitCount: Number.NaN });
    tracker.colonyEliminated({ colonyId: '  ', cause: 'both_lost' });
    tracker.truceSigned({ colonyId: '', partnerColonyId: 'c2', durationHours: 24 });
    tracker.truceSigned({ colonyId: 'c1', partnerColonyId: ' ', durationHours: 24 });
    tracker.truceBroken({ colonyId: 'c1', byColonyId: '' });

    expect(events).toEqual([]);
  });

  it('ignores unrelated sim events and expired truceEnded', () => {
    const { events, tracker } = setupRecorder();

    const p1 = tracker.handleSimEvent({ kind: 'dev.pong' }, 'col_0');
    const p2 = tracker.handleSimEvent(
      { kind: 'truceEnded', data: { truceId: 'tr_exp', reason: 'expired' } },
      'col_0',
    );
    const p3 = tracker.handleSimEvent({ kind: 'alertPing' }, 'col_0');

    expect(p1).toBe(false);
    expect(p2).toBe(false);
    expect(p3).toBe(false);
    expect(events).toEqual([]);
  });
});

describe('PvpTracker boundary cases & deduplication', () => {
  it('handles boundary cases: unitCount 0 and omitted optional fields', () => {
    const { events, tracker } = setupRecorder();

    tracker.raidStarted({
      colonyId: 'c_own',
      targetColonyId: 'c_target',
      unitCount: 0,
    });
    tracker.colonyEliminated({
      colonyId: 'c_own',
      cause: 'abandoned',
    });
    tracker.truceSigned({
      colonyId: 'c_own',
      partnerColonyId: 'c_other',
      durationHours: 2,
    });
    tracker.truceBroken({
      colonyId: 'c_own',
      byColonyId: 'c_own',
    });

    expect(events).toHaveLength(4);
    expect(events[0]?.props).toEqual({ colonyId: 'c_own', targetColonyId: 'c_target', unitCount: 0 });
    expect(events[1]?.props).toEqual({ colonyId: 'c_own', cause: 'abandoned' });
    expect(events[2]?.props).toEqual({ colonyId: 'c_own', partnerColonyId: 'c_other', durationHours: 2 });
    expect(events[3]?.props).toEqual({ colonyId: 'c_own', byColonyId: 'c_own' });
  });

  it('deduplicates duplicate sim events with same ID and emits sequential distinct events', () => {
    const { events, tracker } = setupRecorder();

    const r1 = tracker.handleSimEvent(
      { kind: 'raidStarted', data: { raidId: 'raid_dup', targetColonyId: 'c_2', count: 3 } },
      'c_1',
    );
    const r2 = tracker.handleSimEvent(
      { kind: 'raidStarted', data: { raidId: 'raid_dup', targetColonyId: 'c_2', count: 3 } },
      'c_1',
    );
    const r3 = tracker.handleSimEvent(
      { kind: 'raidStarted', data: { raidId: 'raid_distinct', targetColonyId: 'c_3', count: 1 } },
      'c_1',
    );

    const tNotice = tracker.handleSimEvent(
      { kind: 'truceNotice', data: { truceId: 'tr_dup', cancelledByColonyId: 'c_2' } },
      'c_1',
    );
    const tEnded = tracker.handleSimEvent(
      { kind: 'truceEnded', data: { truceId: 'tr_dup', reason: 'cancelled', cancelledByColonyId: 'c_2' } },
      'c_1',
    );

    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(r3).toBe(true);
    expect(tNotice).toBe(true);
    expect(tEnded).toBe(false);
    expect(events.map((e) => e.name)).toEqual([
      'raid_started',
      'raid_started',
      'truce_broken',
    ]);
  });
});
