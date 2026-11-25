import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaceTradeOrderRequest } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsCounters } from './analytics.counters';
import { AnalyticsService } from './analytics.service';
import { env } from './analytics.module';
import { dailyCookielessId, hasGpcHeader } from './cookieless-id';
import { extractGeoContext, isPublicIp } from './geo-context';
import { PostHogClient } from './posthog-client';
import { ProductRecorder } from './product-recorder';
import { tradeFailReason } from './trade-reason';
import type { AppEnv } from '../core/tokens';

const ANON = '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11';
const PLAYER = 'player-SHOULD-not-leak';
const EMAIL = 'secret-email@example.com';
const TS = 1_700_000_000_000;

interface WireEvent { event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> }
interface Wire { api_key: string; batch: WireEvent[] }
interface Stored { name: string; sessionId?: string; props: Record<string, unknown> }

function parsed(source: Record<string, string | undefined>): AppEnv {
  return env.schema.parse(source) as unknown as AppEnv;
}

function harness(source: Record<string, string | undefined> = {}) {
  const calls: { name: string; labels: Record<string, string> }[] = [];
  const rows: Stored[] = [];
  const sent: { url: string; body: Wire }[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Wire });
    return Promise.resolve(new Response('', { status: 200 }));
  });
  const counters = { count: (name: string, labels: Record<string, string> = {}) => calls.push({ name, labels }) } as unknown as AnalyticsCounters;
  const createMany = vi.fn(async ({ data }: { data: Stored[] }) => {
    rows.push(...data);
    return { count: data.length };
  });
  const create = vi.fn(async ({ data }: { data: Stored }) => {
    rows.push(data);
    return data;
  });
  const prisma = { analyticsEvent: { createMany, create } } as unknown as PrismaClient;
  const appEnv = parsed(source);
  const posthog = new PostHogClient(appEnv);
  const svc = new AnalyticsService(prisma, counters, appEnv, posthog);
  const recorder = new ProductRecorder(prisma, counters, posthog, appEnv);
  return { calls, rows, sent, create, createMany, svc, recorder, appEnv };
}

const order = { side: 'buy', resource: 'bio.water', amount: 1, price: { token: 'USDC', amount: '1' }, ttlS: 60 } as PlaceTradeOrderRequest;
const req = (headers: Record<string, string>): IncomingMessage => ({ headers }) as IncomingMessage;
const on = { POSTHOG_ENABLED: 'true', POSTHOG_KEY: 'phc_test' };

afterEach(() => { vi.unstubAllGlobals(); });

describe('product analytics intake', () => {
  it('does not store or forward a server-plane event in a client batch', async () => {
    const { svc, rows, sent, calls } = harness(on);
    await svc.ingest({
      anonId: ANON, sessionId: 's1', events: [
        { name: 'trade_order_accepted', ts: TS, props: { side: 'buy' } },
        { name: 'surface_viewed', ts: TS, props: { surface: 'landing' } },
        { name: 'not_a_real_event', ts: TS, props: {} },
      ],
    });
    expect(rows.map((row) => row.name)).toEqual(['surface_viewed', 'not_a_real_event']);
    expect(sent[0]?.body.batch.map((event) => event.event)).toEqual(['surface_viewed']);
    expect(calls).toContainEqual({ name: 'ta_analytics_spoof_total', labels: { name: 'trade_order_accepted' } });
  });

  it('drops a spoofed auth_completed', async () => {
    const { svc, rows, sent, create, createMany, calls } = harness(on);
    await svc.ingest({ anonId: ANON, sessionId: 's1', events: [{ name: 'auth_completed', ts: TS, props: { method: 'google' } }] });
    expect(create).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
    expect(sent).toEqual([]);
    expect(calls).toEqual([{ name: 'ta_analytics_spoof_total', labels: { name: 'auth_completed' } }]);
  });

  it('counts a surface ping and writes no row', () => {
    const { svc, calls, create, createMany, sent } = harness(on);
    svc.surface({ surface: 'landing', consent: 'unknown' });
    expect(calls).toEqual([{ name: 'ta_surface_views_total', labels: { surface: 'landing', consent: 'unknown' } }]);
    expect(create).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('stores nothing for a surface ping when analytics is disabled', () => {
    const box = harness({ ANALYTICS_DISABLED: 'true' });
    box.svc.surface({ surface: 'play', consent: 'decline' });
    new AnalyticsController(box.svc, box.appEnv).surface({ surface: 'play', consent: 'allow' });
    expect(box.calls).toEqual([]);
    expect(box.create).not.toHaveBeenCalled();
  });

  it('builds a PostHog batch without email, player id, or a person profile', async () => {
    const { svc, sent } = harness(on);
    await svc.ingest({
      anonId: ANON, sessionId: 's1',
      events: [{ name: 'surface_viewed', ts: TS, props: { surface: 'landing', email: EMAIL, player_id: PLAYER, playerId: PLAYER } }],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://eu.i.posthog.com/batch/');
    const event = sent[0]?.body.batch[0];
    expect(event).toMatchObject({
      event: 'surface_viewed', distinct_id: ANON, timestamp: new Date(TS).toISOString(),
      properties: { surface: 'landing', $process_person_profile: false, $lib: 'terra-relay' },
    });
    const body = JSON.stringify(sent[0]?.body.batch[0]?.properties);
    expect(body).not.toContain(EMAIL);
    expect(body).not.toContain(PLAYER);
    expect(body).not.toContain('player_id');
  });

  it('does not enable PostHog when POSTHOG_ENABLED is 1', async () => {
    expect(env.schema.parse({ POSTHOG_ENABLED: '1', POSTHOG_KEY: 'phc_test' }).POSTHOG_ENABLED).toBe(false);
    const { svc, sent } = harness({ POSTHOG_ENABLED: '1', POSTHOG_KEY: 'phc_test' });
    await svc.ingest({ anonId: ANON, sessionId: 's1', events: [{ name: 'surface_viewed', ts: TS, props: { surface: 'landing' } }] });
    expect(sent).toEqual([]);
  });

  it('lets POSTHOG_DISABLED win over POSTHOG_ENABLED', async () => {
    const flags = env.schema.parse({ POSTHOG_ENABLED: 'true', POSTHOG_DISABLED: 'true', POSTHOG_KEY: 'phc_test' });
    expect(flags.POSTHOG_ENABLED).toBe(true);
    expect(flags.POSTHOG_DISABLED).toBe(true);
    const { svc, sent } = harness({ POSTHOG_ENABLED: 'true', POSTHOG_DISABLED: 'true', POSTHOG_KEY: 'phc_test' });
    await svc.ingest({ anonId: ANON, sessionId: 's1', events: [{ name: 'surface_viewed', ts: TS, props: { surface: 'me' } }] });
    expect(sent).toEqual([]);
  });
});

describe('server commits', () => {
  it('identifies with the hmac and leaves the player id out of the body', async () => {
    const { recorder, sent, rows } = harness({ ...on, POSTHOG_PERSON_SALT: 'person-salt' });
    await recorder.recordServerEvent({
      name: 'auth_completed', anonId: ANON, playerId: PLAYER,
      props: { method: 'google', wallet_kind: 'none', email: EMAIL, player_id: PLAYER, account_id: 'acct.testnet', address: 'ed25519:abc' },
    });
    const hmac = createHmac('sha256', 'person-salt').update(PLAYER).digest('hex').slice(0, 32);
    const batch = sent[0]?.body.batch ?? [];
    const identify = batch.find((event) => event.event === '$identify');
    const auth = batch.find((event) => event.event === 'auth_completed');
    expect(identify?.distinct_id).toBe(hmac);
    expect(identify?.properties).toEqual({ $anon_distinct_id: ANON, $set: { auth_method: 'google', wallet_kind: 'none' } });
    expect(auth?.distinct_id).toBe(ANON);
    expect(batch.some((event) => event.event === '$create_alias')).toBe(false);
    const wire = JSON.stringify(sent) + JSON.stringify(rows);
    expect(wire).not.toContain(PLAYER);
    expect(wire).not.toContain(EMAIL);
    expect(wire).not.toContain('acct.testnet');
    expect(wire).not.toContain('ed25519:abc');
  });

  it('sends auth_completed on the anon id when the person salt is blank', async () => {
    const { recorder, sent } = harness({ ...on, POSTHOG_PERSON_SALT: '  ' });
    await recorder.recordServerEvent({ name: 'auth_completed', anonId: ANON, playerId: PLAYER, props: { method: 'x', wallet_kind: 'none' } });
    expect(sent[0]?.body.batch.map((event) => event.event)).toEqual(['auth_completed']);
    expect(sent[0]?.body.batch[0]?.distinct_id).toBe(ANON);
  });

  it('only counts when the anon id is missing', async () => {
    const { recorder, rows, sent, calls } = harness(on);
    await recorder.recordServerEvent({ name: 'auth_completed', playerId: PLAYER, props: { method: 'email', wallet_kind: 'none' } });
    expect(rows).toEqual([]);
    expect(sent).toEqual([]);
    expect(calls).toContainEqual({ name: 'ta_auth_completed_total', labels: { method: 'email', wallet_kind: 'none' } });
  });

  it('records an accepted trade and a server failure without a client duplicate', async () => {
    const { recorder, rows, sent } = harness(on);
    const headers = req({ 'x-terra-anon': ANON });
    await recorder.recordTradePlace(headers, order, { status: 'accepted', requestId: 'r1' });
    await recorder.recordTradePlace(headers, order, { status: 'pending', requestId: 'r2' });
    await recorder.recordTradePlace(headers, order, { code: 'insufficient_cargo' });
    expect(rows.map((row) => row.name)).toEqual(['trade_order_accepted', 'trade_order_failed']);
    expect(rows[1]?.props).toMatchObject({ side: 'buy', source: 'server', reason: 'insufficient', pair: 'bio.water-USDC' });
    expect(rows[0]?.props).toMatchObject({ pair: 'bio.water-USDC', side: 'buy' });
    expect(sent.flatMap((item) => item.body.batch.map((event) => event.event))).toEqual(['trade_order_accepted', 'trade_order_failed']);
  });

  it('reads auth headers without logging the player id', async () => {
    const { recorder, rows, sent } = harness(on);
    await recorder.recordAuthCompleted(req({ 'x-terra-anon': ANON }), 'google', PLAYER);
    await recorder.recordAuthCompleted(req({ 'x-terra-anon': ANON }), 'near-wallet', PLAYER);
    await recorder.recordAuthCompleted(req({ 'x-terra-anon': ANON, 'x-terra-wallet': 'nope' }), 'email', PLAYER);
    expect(rows.map((row) => row.props.wallet_kind)).toEqual(['none', 'other', 'other']);
    expect(JSON.stringify(sent) + JSON.stringify(rows)).not.toContain(PLAYER);
  });
});

describe('tradeFailReason', () => {
  it('returns each catalog reason for a representative code, and unknown otherwise', () => {
    expect(tradeFailReason('invalid_request')).toBe('validation');
    expect(tradeFailReason('pair_not_allowed')).toBe('rejected');
    expect(tradeFailReason('host_unavailable')).toBe('network');
    expect(tradeFailReason('insufficient_cargo')).toBe('insufficient');
    expect(tradeFailReason('offer_expired')).toBe('expired');
    expect(tradeFailReason('etimedout')).toBe('timeout');
    expect(tradeFailReason('not-a-real-code')).toBe('unknown');
    expect(tradeFailReason(undefined)).toBe('unknown');
  });
});

describe('geo context relay', () => {
  it('forwards public IP and country code to PostHog only, never storing IP in Postgres rows', async () => {
    const { svc, rows, sent } = harness(on);
    const geo = extractGeoContext({
      headers: { 'x-forwarded-for': '127.0.0.1, 8.8.8.8', 'cf-ipcountry': 'de' },
      ip: '172.18.0.5',
    });
    expect(geo).toEqual({ clientIp: '8.8.8.8', countryCode: 'DE' });
    await svc.ingest({
      anonId: ANON,
      sessionId: 's1',
      events: [{ name: 'surface_viewed', ts: TS, props: { surface: 'landing' } }],
    }, geo);
    expect(JSON.stringify(rows)).not.toContain('8.8.8.8');
    expect(rows[0]?.props).toEqual({ surface: 'landing' });
    expect(sent[0]?.body.batch[0]?.properties).toMatchObject({
      surface: 'landing',
      $ip: '8.8.8.8',
      $geoip_country_code: 'DE',
      $geoip_country_name: 'Germany',
      $process_person_profile: false,
    });
  });

  it('rejects private/loopback IPs and invalid country headers', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false);
    expect(isPublicIp('10.20.0.1')).toBe(false);
    expect(isPublicIp('172.18.0.2')).toBe(false);
    expect(isPublicIp('192.168.1.5')).toBe(false);
    expect(isPublicIp('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicIp('::1')).toBe(false);
    expect(isPublicIp('1.1.1.1')).toBe(true);
    expect(extractGeoContext({
      headers: { 'x-forwarded-for': '192.168.0.1', 'cf-ipcountry': 'XX' },
      ip: '127.0.0.1',
    })).toEqual({});
  });
});

describe('cookieless daily visitor ID', () => {
  const day1 = new Date('2026-11-25T10:00:00Z');
  const day1Late = new Date('2026-11-25T23:59:59Z');
  const day2 = new Date('2026-11-26T00:00:01Z');

  it('produces a deterministic UUID per UTC day, rotates across midnight, and isolates different visitors', () => {
    const reqA = { headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Mozilla/5.0 TestBrowser' } };
    const reqB = { headers: { 'x-forwarded-for': '5.6.7.8', 'user-agent': 'Mozilla/5.0 TestBrowser' } };
    const id1 = dailyCookielessId(reqA, 'salt-1', day1);
    const id1Later = dailyCookielessId(reqA, 'salt-1', day1Late);
    const id2 = dailyCookielessId(reqA, 'salt-1', day2);
    const idB = dailyCookielessId(reqB, 'salt-1', day1);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id1).toBe(id1Later);
    expect(id2).not.toBe(id1);
    expect(idB).not.toBe(id1);
    expect(dailyCookielessId({ headers: {} }, 'salt-1', day1)).toBeUndefined();
  });

  it('stitches client batches and server commits onto the same daily cookieless ID and honors Sec-GPC', async () => {
    const { svc, recorder, sent, rows, appEnv } = harness({ ...on, POSTHOG_PERSON_SALT: 'person-salt' });
    const ctrl = new AnalyticsController(svc, appEnv);
    const httpReq = {
      headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Chrome/130', 'x-terra-anon': ANON },
      is: () => false,
    } as unknown as Parameters<AnalyticsController['events']>[0];

    await ctrl.events(httpReq, {
      anonId: '11111111-1111-4111-8111-111111111111',
      sessionId: 's1',
      events: [{ name: 'surface_viewed', ts: TS, props: { surface: 'landing' } }],
    });
    await recorder.recordAuthCompleted(httpReq as unknown as IncomingMessage, 'google', PLAYER);

    const clientDistinct = sent[0]?.body.batch[0]?.distinct_id;
    const serverAuth = sent[1]?.body.batch.find((e) => e.event === 'auth_completed');
    const serverIdentify = sent[1]?.body.batch.find((e) => e.event === '$identify');
    expect(clientDistinct).toBeDefined();
    expect(clientDistinct).not.toBe('11111111-1111-4111-8111-111111111111');
    expect(clientDistinct).not.toBe(ANON);
    expect(serverAuth?.distinct_id).toBe(clientDistinct);
    expect(serverIdentify?.properties.$anon_distinct_id).toBe(clientDistinct);
    expect(JSON.stringify(rows)).not.toContain('1.2.3.4');
    expect(JSON.stringify(rows)).not.toContain('Chrome/130');

    // Sec-GPC: 1 drops both client batches and server PostHog/DB rows
    const gpcReq = {
      headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'Chrome/130', 'x-terra-anon': ANON, 'sec-gpc': '1' },
      is: () => false,
    } as unknown as Parameters<AnalyticsController['events']>[0];
    expect(hasGpcHeader(gpcReq)).toBe(true);
    const sentBefore = sent.length;
    await ctrl.events(gpcReq, {
      anonId: ANON,
      sessionId: 's2',
      events: [{ name: 'surface_viewed', ts: TS, props: { surface: 'play' } }],
    });
    await recorder.recordAuthCompleted(gpcReq as unknown as IncomingMessage, 'google', PLAYER);
    expect(sent).toHaveLength(sentBefore);
  });
});
