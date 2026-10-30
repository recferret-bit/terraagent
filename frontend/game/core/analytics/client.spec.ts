import { describe, expect, it, vi } from 'vitest';
import { AnalyticsClient, BATCH_MAX, FLUSH_MS, type AnalyticsDeps } from './client';

function setup(consent = false) {
  let allowed = consent;
  let aid: string | undefined;
  let tick: (() => void) | undefined;
  let t = 1000;
  const sent: { url: string; body: any; via: string }[] = [];
  const d: AnalyticsDeps = {
    readConsent: () => allowed,
    writeConsent: (a) => void (allowed = a),
    anonId: () => (aid ??= '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11'),
    clearAnonId: () => void (aid = undefined),
    newSessionId: () => 'sess',
    fetch: vi.fn(async (url, init) => void sent.push({ url, body: JSON.parse(init.body), via: 'fetch' })),
    sendBeacon: vi.fn((url, body) => (sent.push({ url, body: JSON.parse(body), via: 'beacon' }), true)),
    now: () => t++,
    setInterval: (fn) => ((tick = fn), 1),
    clearInterval: () => void (tick = undefined),
  };
  return { c: new AnalyticsClient(d), d, sent, tick: () => tick?.(), aid: () => aid };
}

describe('AnalyticsClient', () => {
  it('is off by default: track sends nothing and creates no anonId', async () => {
    const { c, d, sent, aid } = setup();
    c.track('test_event');
    await c.flush();
    expect(sent).toEqual([]);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(aid()).toBeUndefined();
  });

  it('flushes on the interval after consent', async () => {
    const { c, sent, tick } = setup();
    c.setConsent(true);
    c.track('test_event', { a: 1 });
    expect(sent).toEqual([]);
    tick();
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/v1/analytics/events');
    expect(sent[0]!.body).toMatchObject({ anonId: expect.any(String), sessionId: 'sess', events: [{ name: 'test_event', props: { a: 1 } }] });
    expect(FLUSH_MS).toBe(10_000);
  });

  it('flushes when 20 events are queued, in batches of at most 20', async () => {
    const { c, sent } = setup(true);
    for (let i = 0; i < BATCH_MAX; i++) c.track('ev_x');
    await c.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.events).toHaveLength(20);
    for (let i = 0; i < 25; i++) c.track('ev_x');
    await c.flush();
    expect(sent.slice(1).map((s) => s.body.events.length)).toEqual([20, 5]);
  });

  it('uses sendBeacon on pagehide', async () => {
    const { c, sent } = setup(true);
    c.track('bye_event');
    c.onPageHide();
    await Promise.resolve();
    expect(sent.map((s) => s.via)).toEqual(['beacon']);
  });

  it('withdrawing consent drops the queue, the anonId and further tracking', async () => {
    const { c, sent, aid } = setup(true);
    c.track('ev_x');
    await c.flush();
    expect(aid()).toBeDefined();
    c.track('ev_y');
    c.setConsent(false);
    c.track('ev_z');
    await c.flush();
    expect(sent).toHaveLength(1);
    expect(aid()).toBeUndefined();
  });

  it('drops invalid names and swallows network errors', async () => {
    const { c, d, sent } = setup(true);
    c.track('Bad Name');
    await c.flush();
    expect(sent).toEqual([]);
    (d.fetch as any).mockRejectedValueOnce(new Error('offline'));
    c.track('ev_x');
    await expect(c.flush()).resolves.toBeUndefined();
  });
});
