// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsClient, type AnalyticsDeps } from '../../../core/analytics/client';
import type { FeatureContext } from '../../../core/registry/types';
import bountyFeature from '../../bounty';
import { BOUNTY_EVENTS } from '../../bounty/bountyEvents';
import { CouncilPanel } from '../CouncilPanel';
import treasuryFeature from '../index';
import { TREASURY_CLIENT_EVENTS, TREASURY_EVENTS } from './treasuryTracker';

function client(consent: boolean) {
  const sent: Array<{ events: Array<{ name: string; props: Record<string, unknown> }> }> = [];
  let allowed = consent;
  const deps: AnalyticsDeps = {
    readConsent: () => allowed,
    writeConsent: (next) => void (allowed = next),
    anonId: () => '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11',
    clearAnonId: () => undefined,
    newSessionId: () => 's',
    fetch: vi.fn(async (_url, init) => void sent.push(JSON.parse(String(init.body)))),
    sendBeacon: () => true,
    now: () => 1,
    setInterval: () => 1,
    clearInterval: () => undefined,
  };
  const analytics = new AnalyticsClient(deps);
  const names = async () => {
    await analytics.flush();
    return sent.flatMap((batch) => batch.events);
  };
  return { analytics, names, sent };
}

function panel(track: (name: string, props?: never) => void, waves: string[]) {
  const host = document.createElement('div');
  document.body.append(host);
  const ctx = {
    flags: new Set(waves),
    host: 'server',
    services: { track, session: { planetId: () => 'pl_dune' } },
  } as unknown as FeatureContext;
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ balance: {}, members: [], proposals: [], projects: [] }) }) as Response;
  return new CouncilPanel(host, host, ctx, { fetchImpl });
}

describe('council analytics (W22-34)', () => {
  it('sends council_opened once when the sheet opens, and no server event names', async () => {
    const { analytics, names } = client(true);
    const sheet = panel((name, props) => analytics.track(name, props), ['W22']);
    await sheet.open();
    const events = await names();
    expect(events.map((event) => event.name)).toEqual(['council_opened']);
    expect(events[0]?.props).toEqual({});
    for (const name of ['proposal_created', 'vote_cast', ...BOUNTY_EVENTS]) {
      expect(events.some((event) => event.name === name)).toBe(false);
    }
    sheet.dispose();
  });

  it('sends nothing without consent, and nothing when W22 is off', async () => {
    const denied = client(false);
    const closed = panel((name, props) => denied.analytics.track(name, props), ['W22']);
    await closed.open();
    expect(await denied.names()).toEqual([]);
    expect(denied.sent).toEqual([]);
    closed.dispose();
    const allowed = client(true);
    const off = panel((name, props) => allowed.analytics.track(name, props), ['W00']);
    await off.open();
    expect(await allowed.names()).toEqual([]);
    off.dispose();
  });

  it('registers treasury and bounty event names without the client owning the server rows', () => {
    expect(treasuryFeature.analytics).toEqual([...TREASURY_EVENTS]);
    expect(TREASURY_CLIENT_EVENTS).toEqual(['council_opened']);
    expect(bountyFeature.analytics).toEqual([...BOUNTY_EVENTS]);
  });
});
