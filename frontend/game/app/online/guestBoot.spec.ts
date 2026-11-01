import { describe, expect, it } from 'vitest';
import { BootError, DEVICE_SECRET_KEY, HOME_ATTEMPTS, backendUnreachable, bootAuthAndHome, deviceSecretKey, type FetchLike, type StorageLike } from './bootOnline';
import { GuestBootTarget } from './guestBoot';
import { activeHome, TEST_COLONY_ID } from './homeFixture';

const PLAYER = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const memStorage = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

/** Guest login hands out `jwt-guest`, refresh hands out `jwt-refresh-<n>`; both valid 900 s. */
function server(): FetchLike & { calls: string[]; secrets: string[] } {
  let refreshes = 0;
  const f = (async (url: string, init?: RequestInit) => {
    f.calls.push(url);
    if (url === '/v1/auth/guest') {
      f.secrets.push((JSON.parse(String(init?.body)) as { deviceSecret: string }).deviceSecret);
      return json(200, { accessToken: 'jwt-guest', expiresIn: 900, player: { id: PLAYER, handle: 'C', isGuest: true } });
    }
    if (url === '/v1/auth/refresh') return json(200, { accessToken: `jwt-refresh-${++refreshes}`, expiresIn: 900, player: { id: PLAYER, handle: 'C', isGuest: true } });
    if (url.startsWith('/v1/me/home')) {
      return json(200, activeHome({ colonyIndex: 1, spawnQ: 1, spawnR: 2 }));
    }
    return json(404, {});
  }) as FetchLike & { calls: string[]; secrets: string[] };
  f.calls = [];
  f.secrets = [];
  return f;
}

describe('guest device secret per ?as= (FA-10)', () => {
  it('dev builds key the secret by ?as=; production and plain URLs use ta_device_secret', () => {
    expect(deviceSecretKey('?as=B!', true)).toBe('ta_device_secret:b');
    expect(deviceSecretKey('', true)).toBe(DEVICE_SECRET_KEY);
    expect(deviceSecretKey('?as=b', false)).toBe(DEVICE_SECRET_KEY);
  });

  it('?as=b and ?as=c log in as two different guests in one profile', async () => {
    const storage = memStorage();
    const f = server();
    await bootAuthAndHome({ fetch: f, storage, search: '?as=b' });
    await bootAuthAndHome({ fetch: f, storage, search: '?as=c' });
    await bootAuthAndHome({ fetch: f, storage, search: '?as=b' });
    expect(f.secrets[0]).not.toBe(f.secrets[1]);
    expect(f.secrets[2]).toBe(f.secrets[0]);
    expect([...storage.map.keys()].sort()).toEqual(['ta_device_secret:b', 'ta_device_secret:c']);
  });
});

describe('boot failures (FA-06)', () => {
  it('only a missing answer or a 5xx counts as an unreachable server', async () => {
    expect(backendUnreachable(new BootError('x', null))).toBe(true);
    expect(backendUnreachable(new BootError('x', 502))).toBe(true);
    expect(backendUnreachable(new BootError('x', 429))).toBe(false);
    expect(backendUnreachable(new Error('bad json'))).toBe(false);
    const down: FetchLike = async () => { throw new TypeError('Failed to fetch'); };
    await expect(bootAuthAndHome({ fetch: down, storage: memStorage(), search: '', allowLocalFallback: false }))
      .rejects.toMatchObject({ name: 'BootError', status: null });
    const local = await bootAuthAndHome({ fetch: down, storage: memStorage(), search: '', allowLocalFallback: true });
    expect(local.mode).toBe('local');
  });
});

describe('/v1/me/home answers of the hardened server (BE-14, BE-17, BE-21)', () => {
  const PLAYER_AUTH = { accessToken: 'jwt-guest', expiresIn: 900, player: { id: PLAYER, handle: 'C', isGuest: true } };
  /** Guest login, then `homes` in order for each `/v1/me/home` call (the last one repeats). */
  function homeServer(...homes: Array<{ status: number; body: unknown }>): FetchLike & { homeCalls: number } {
    const f = (async (url: string) => {
      if (url === '/v1/auth/guest') return json(200, PLAYER_AUTH);
      if (url.startsWith('/v1/me/home')) { const h = homes[Math.min(f.homeCalls++, homes.length - 1)]; return json(h.status, h.body); }
      return json(404, {});
    }) as FetchLike & { homeCalls: number };
    f.homeCalls = 0;
    return f;
  }
  const envelope = (status: number, errorCode: string, code: string) => ({ status, body: { errorCode, error: { code, message: errorCode }, requestId: 'rq' } });
  const unavailable = envelope(503, 'HOME_UNAVAILABLE', 'unavailable');
  const throttled = envelope(429, 'TOO_MANY_REQUESTS', 'rate_limited');
  const fakeTime = () => { const waits: number[] = []; return { waits, wait: async (ms: number) => { waits.push(ms); } }; };

  it('503 HOME_UNAVAILABLE and 429 are retried with the reconnect backoff, then the home boots', async () => {
    const f = homeServer(unavailable, throttled, unavailable, { status: 200, body: activeHome({ colonyIndex: 3 }) });
    const t = fakeTime();
    const statuses: string[] = [];
    const boot = await bootAuthAndHome({ fetch: f, storage: memStorage(), search: '', wait: t.wait, random: () => 0.5, onStatus: (x) => statuses.push(x) });
    expect([boot.mode, boot.colony.id, boot.colony.colonyIndex]).toEqual(['online', TEST_COLONY_ID, 3]);
    expect(f.homeCalls).toBe(4);
    expect(t.waits).toEqual([500, 1000, 2000]);
    expect(statuses.filter((x) => x.includes('retrying'))).toEqual([
      `Home planet is starting, retrying (1/${HOME_ATTEMPTS - 1})…`, `Orbit is busy, retrying (2/${HOME_ATTEMPTS - 1})…`, `Home planet is starting, retrying (3/${HOME_ATTEMPTS - 1})…`,
    ]);
  });

  it('a 503 HOME_UNAVAILABLE that lasts is an error splash, never the dev local fallback (the server is up)', async () => {
    const f = homeServer(unavailable);
    const t = fakeTime();
    const err = await bootAuthAndHome({ fetch: f, storage: memStorage(), search: '', allowLocalFallback: true, wait: t.wait, random: () => 0.5 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'BootError', status: 503, code: 'HOME_UNAVAILABLE', message: 'GET /v1/me/home: 503 HOME_UNAVAILABLE' });
    expect(backendUnreachable(err)).toBe(false);
    expect(f.homeCalls).toBe(HOME_ATTEMPTS);
    expect(t.waits).toHaveLength(HOME_ATTEMPTS - 1);
    // other server errors are not retried
    const g = homeServer(envelope(409, 'COLONY_SEAT_REJECTED', 'seat_rejected'));
    await expect(bootAuthAndHome({ fetch: g, storage: memStorage(), search: '', wait: t.wait })).rejects.toMatchObject({ status: 409, code: 'COLONY_SEAT_REJECTED' });
    expect(g.homeCalls).toBe(1);
  });

  it('a home that is not ACTIVE names its state instead of booting a made-up colony on pl_dev', async () => {
    const boot = (body: unknown) => bootAuthAndHome({ fetch: homeServer({ status: 200, body }), storage: memStorage(), search: '', allowLocalFallback: true });
    await expect(boot({ state: 'NEW', planets: [], newPlanetTypes: ['desert'] }))
      .rejects.toMatchObject({ name: 'BootError', code: 'HOME_NEW', message: 'No colony was seated for this player (new colonies: desert)' });
    await expect(boot({ state: 'ELIMINATED', recap: {}, planets: [], newPlanetTypes: ['desert'] }))
      .rejects.toMatchObject({ code: 'HOME_ELIMINATED', message: 'Your colony was eliminated (new colonies: desert)' });
    await expect(boot({ state: 'PLANET_ENDED', results: {}, planets: [], newPlanetTypes: ['desert'] })).rejects.toMatchObject({ code: 'HOME_PLANET_ENDED' });
    await expect(boot({ colony: { id: 'col_1' }, planet: { id: 'pl_dev' } })).rejects.toMatchObject({ code: 'BAD_HOME', status: 200 });
  });
});

describe('GuestBootTarget (FA-01)', () => {
  it('keeps the token expiry from the auth response and refresh() swaps in a renewed token', async () => {
    let now = 1_000;
    const f = server();
    const booted: string[] = [];
    const t = new GuestBootTarget('ws://x/ws', { fetch: f, storage: memStorage(), search: '', now: () => now, onBooted: (b) => booted.push(b.colony.id) });
    const boot = await t.boot();
    expect(boot?.tokenExpiresInS).toBe(900);
    expect(t.accessToken).toBe('jwt-guest');
    expect(t.tokenExpiresAtMs).toBe(1_000 + 900_000);
    expect(booted).toEqual([TEST_COLONY_ID]); // a server-minted `co_<ULID>` colony id passes through as is
    expect(await t.resolve()).toEqual({ planetId: 'pl_dev' }); // a reconnect re-uses the seat, no new HTTP boot
    expect(f.calls.filter((u) => u.startsWith('/v1/me/home'))).toHaveLength(1);
    now = 841_000;
    expect(await t.refresh()).toBe(true);
    expect(t.accessToken).toBe('jwt-refresh-1');
    expect(t.tokenExpiresAtMs).toBe(841_000 + 900_000);
    expect(t.result?.accessToken).toBe('jwt-refresh-1');
  });

  it('a local fallback has nothing to refresh', async () => {
    const down: FetchLike = async () => json(500, {});
    const t = new GuestBootTarget('ws://x/ws', { fetch: down, storage: memStorage(), search: '', allowLocalFallback: true, onBooted: () => undefined });
    expect((await t.boot())?.mode).toBe('local');
    expect(t.tokenExpiresAtMs).toBeUndefined();
    expect(await t.refresh()).toBe(false);
  });
});
