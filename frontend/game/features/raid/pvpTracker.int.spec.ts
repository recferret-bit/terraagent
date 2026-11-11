import { describe, expect, it, vi } from 'vitest';
import { AnalyticsClient, type AnalyticsDeps } from '../../core/analytics/client';
import { createPvpTracker, PVP_EVENTS } from './pvpTracker';

function setupAnalyticsHarness(initialConsent = false) {
  let consent = initialConsent;
  let anonIdValue: string | undefined;
  const sentPayloads: Array<{ url: string; events: Array<{ name: string; props: Record<string, unknown> }> }> = [];

  const deps: AnalyticsDeps = {
    readConsent: () => consent,
    writeConsent: (allowed) => {
      consent = allowed;
    },
    anonId: () => (anonIdValue ??= 'test-anon-id-1234'),
    clearAnonId: () => {
      anonIdValue = undefined;
    },
    newSessionId: () => 'test-session-5678',
    fetch: vi.fn(async (url, init) => {
      const parsed = JSON.parse(init.body);
      sentPayloads.push({ url, events: parsed.events });
    }),
    sendBeacon: vi.fn(() => true),
    now: () => Date.now(),
    setInterval: () => 1,
    clearInterval: () => {},
  };

  const client = new AnalyticsClient(deps);
  const tracker = createPvpTracker((name, props) => client.track(name, props));

  return { client, tracker, sentPayloads, deps, setConsent: (val: boolean) => client.setConsent(val) };
}

describe('PvpTracker analytics flow with granted consent', () => {
  it('flows all PVP_EVENTS through AnalyticsClient to transport sink when consent is granted', async () => {
    const { tracker, client, sentPayloads } = setupAnalyticsHarness(true);

    tracker.raidStarted({
      colonyId: 'col_attacker',
      targetColonyId: 'col_defender',
      unitCount: 12,
      planetId: 'planet_tau',
      attackerColonyId: 'col_attacker',
    });
    tracker.colonyEliminated({
      colonyId: 'col_defender',
      cause: 'both_lost',
      planetId: 'planet_tau',
      killerColonyId: 'col_attacker',
    });
    tracker.truceSigned({
      colonyId: 'col_attacker',
      partnerColonyId: 'col_third',
      durationHours: 24,
      planetId: 'planet_tau',
      truceId: 'tr_24h',
    });
    tracker.truceBroken({
      colonyId: 'col_attacker',
      byColonyId: 'col_third',
      partnerColonyId: 'col_third',
      planetId: 'planet_tau',
      truceId: 'tr_24h',
      oathbreakerHours: 48,
    });

    await client.flush();

    expect(sentPayloads).toHaveLength(1);
    const recordedEvents = sentPayloads[0]?.events ?? [];
    const eventNames = recordedEvents.map((e) => e.name);

    expect(eventNames).toEqual([...PVP_EVENTS]);
    expect(recordedEvents[0]?.props).toMatchObject({
      colonyId: 'col_attacker',
      targetColonyId: 'col_defender',
      unitCount: 12,
      planetId: 'planet_tau',
    });
    expect(recordedEvents[1]?.props).toMatchObject({
      colonyId: 'col_defender',
      cause: 'both_lost',
      killerColonyId: 'col_attacker',
    });
    expect(recordedEvents[2]?.props).toMatchObject({
      colonyId: 'col_attacker',
      partnerColonyId: 'col_third',
      durationHours: 24,
    });
    expect(recordedEvents[3]?.props).toMatchObject({
      colonyId: 'col_attacker',
      byColonyId: 'col_third',
      oathbreakerHours: 48,
    });
  });
});

describe('PvpTracker consent gating (CL-11)', () => {
  it('drops all PvpTracker events when consent is denied or withdrawn', async () => {
    const { tracker, client, sentPayloads, deps } = setupAnalyticsHarness(false);

    tracker.raidStarted({
      colonyId: 'col_attacker',
      targetColonyId: 'col_defender',
      unitCount: 4,
    });
    tracker.colonyEliminated({
      colonyId: 'col_defender',
      cause: 'critical_timeout',
    });
    tracker.truceSigned({
      colonyId: 'col_attacker',
      partnerColonyId: 'col_third',
      durationHours: 6,
    });
    tracker.truceBroken({
      colonyId: 'col_attacker',
      byColonyId: 'col_third',
    });

    await client.flush();

    expect(sentPayloads).toHaveLength(0);
    expect(deps.fetch).not.toHaveBeenCalled();

    // Withdrawing consent after granting drops queued events
    client.setConsent(true);
    tracker.raidStarted({
      colonyId: 'col_attacker',
      targetColonyId: 'col_defender',
      unitCount: 5,
    });
    client.setConsent(false);
    await client.flush();

    expect(sentPayloads).toHaveLength(0);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('PvpTracker mid-session consent toggle', () => {
  it('records only events emitted after consent is toggled on mid-session', async () => {
    const { tracker, client, sentPayloads } = setupAnalyticsHarness(false);

    // Initial events while consent is false - must be ignored
    tracker.raidStarted({
      colonyId: 'col_silent',
      targetColonyId: 'col_victim',
      unitCount: 10,
    });
    await client.flush();
    expect(sentPayloads).toHaveLength(0);

    // Player grants consent mid-session
    client.setConsent(true);

    tracker.truceSigned({
      colonyId: 'col_active',
      partnerColonyId: 'col_partner',
      durationHours: 72,
      truceId: 'tr_mid_session',
    });
    tracker.truceBroken({
      colonyId: 'col_active',
      byColonyId: 'col_partner',
      truceId: 'tr_mid_session',
    });

    await client.flush();

    expect(sentPayloads).toHaveLength(1);
    const recordedEvents = sentPayloads[0]?.events ?? [];
    expect(recordedEvents.map((e) => e.name)).toEqual(['truce_signed', 'truce_broken']);
    expect(recordedEvents[0]?.props).toMatchObject({
      colonyId: 'col_active',
      partnerColonyId: 'col_partner',
      durationHours: 72,
    });
    expect(recordedEvents[1]?.props).toMatchObject({
      colonyId: 'col_active',
      byColonyId: 'col_partner',
    });
  });
});
