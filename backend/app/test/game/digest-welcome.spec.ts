import { HomeResponseSchema, RESOURCE_KEYS, Welcome, type AwayDigestV1, type HomeResponse, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, createState, insertRow, snapshot } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { attachAwaySummary } from '../../src/core/home/away-headline';
import { emptyDigest } from '../../src/game/digest/body';
import { MemoryDigestStore } from '../../src/game/digest/memory-store';
import { AwayDigestService } from '../../src/game/digest/service';
import type { DigestBaseline } from '../../src/game/digest/types';
import { welcomeFields } from '../../src/ws/welcome-digest';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PLANET = 'pl_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function stock(over: Partial<Record<ResourceKey, number>> = {}): Record<ResourceKey, number> {
  const out = {} as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) out[key] = over[key] ?? 0;
  return out;
}

function clock(start = Date.parse('2026-11-09T12:00:00.000Z')) {
  let t = start;
  return {
    now: () => new Date(t),
    add: (ms: number) => {
      t += ms;
    },
  };
}

function service(store = new MemoryDigestStore(), reader?: { read: () => Promise<DigestBaseline | null> }, c = clock()) {
  return { store, c, svc: new AwayDigestService({ store, now: c.now, ...(reader ? { reader } : {}) }) };
}

const away = () => ({
  planetId: PLANET,
  tick: 1,
  kind: 'colonyAway',
  colonyIds: [COLONY],
  data: { colonyId: COLONY, atTick: 1 },
});
const raid = (n: number) => ({
  planetId: PLANET,
  tick: n,
  kind: 'raidStarted',
  colonyIds: [COLONY],
  data: { colonyId: COLONY, species: `R${n}`, q: 1, r: 2 },
});

function planetBytes(): Uint8Array {
  const state = createState({ planetId: PLANET, planetType: 'desert', seed: 'digest', radius: 2 });
  state.colonies.push({
    index: 0,
    id: COLONY,
    name: 'A',
    color: 1,
    status: 'active',
    changedAt: 0,
    stock: { 'metals.t1': 12 },
    power: { net: -4 },
  });
  state.grid.layers.owner[0] = 0;
  state.grid.layers.owner[1] = 0;
  const worker = insertRow(state.entities, 1, 0);
  state.entities.cols.kind[worker] = ENTITY_KIND.worker;
  state.entities.cols.owner[worker] = 0;
  state.entities.cols.hp[worker] = 5;
  return snapshot(state);
}

function activeHome(): Extract<HomeResponse, { state: 'ACTIVE' }> {
  return {
    state: 'ACTIVE',
    colony: { id: COLONY, planetId: PLANET, name: 'A', color: 1, state: 'ACTIVE' },
    planet: { id: PLANET, name: 'P', type: 'temperate', state: 'ACTIVE', seats: { taken: 1, capacity: 4 } },
  };
}

function welcomeMessage(awayDigest: AwayDigestV1 | null) {
  return {
    v: 1 as const,
    t: 'welcome' as const,
    tick: 1,
    d: {
      reason: 'join' as const,
      colonyId: COLONY,
      planet: { id: PLANET, type: 'temperate' as const, name: 'P' },
      state: new Uint8Array([1]),
      simVersion: 1,
      dataHash: 'abc',
      tick: 1,
      serverTimeMs: 1,
      tickMs: 200 as const,
      deltaHz: 5 as const,
      flags: ['W09'],
      ...welcomeFields('join', awayDigest),
    },
  };
}

async function close(store: MemoryDigestStore, body: AwayDigestV1, openedAt: string, closedAt: string): Promise<void> {
  const row = await store.insert({
    colonyId: COLONY,
    planetId: PLANET,
    openedAt: new Date(openedAt),
    lastEventSeq: 0n,
    body,
  });
  await store.save(row.id, body, 0n, new Date(closedAt));
}

const base: DigestBaseline = { resources: stock({ 'metals.t1': 4 }), energy: 2, robots: 3, territory: 5 };

describe('welcome and home carry one away digest', () => {
  it('copies a closed digest onto welcome and puts durationS on awaySummary', async () => {
    const { svc, c } = service(new MemoryDigestStore(), { async read() { return base; } });
    await svc.onPlanetEvent(away());
    await svc.onPlanetEvent(raid(1));
    c.add(600_000);
    const summary = await svc.headline(COLONY);
    expect(summary?.durationS).toBe(600);
    expect(summary?.attacks).toBe(1);
    const body = await svc.deliverWelcome(COLONY, c.now(), planetBytes());
    expect(body?.durationS).toBe(600);
    expect(body?.resources['metals.t1']).toEqual({ before: 4, after: 12 });
    expect(body?.energy).toEqual({ before: 2, after: -4 });
    expect(body?.robots).toMatchObject({ before: 3, after: 1 });
    expect(body?.territory).toEqual({ before: 5, after: 2 });
    const parsed = Welcome.parse(welcomeMessage(body));
    expect(parsed.d.away).toEqual(body);
    const home = await attachAwaySummary(activeHome(), { headline: async () => summary });
    expect(home).toMatchObject({ state: 'ACTIVE', awaySummary: { durationS: 600 } });
    expect(HomeResponseSchema.parse(home).state).toBe('ACTIVE');
    expect(await svc.headline(COLONY)).toBeNull();
    expect(await svc.deliverWelcome(COLONY, c.now())).toBeNull();
  });

  it('omits away and awaySummary when the colony has no digest', async () => {
    const { svc, c } = service();
    expect(await svc.deliverWelcome(COLONY, c.now(), planetBytes())).toBeNull();
    const welcome = welcomeMessage(null);
    expect(welcome.d).not.toHaveProperty('away');
    expect(Welcome.parse(welcome).d.away).toBeUndefined();
    const home = await attachAwaySummary(activeHome(), svc);
    expect(home).not.toHaveProperty('awaySummary');
    expect(HomeResponseSchema.parse(home).state).toBe('ACTIVE');
  });

  it('leaves before equal to after when the snapshot cannot be read', async () => {
    const { svc, c } = service(new MemoryDigestStore(), { async read() { return base; } });
    await svc.onPlanetEvent(away());
    const body = await svc.deliverWelcome(COLONY, c.now(), new Uint8Array([9]));
    expect(body?.resources['metals.t1']).toEqual({ before: 4, after: 4 });
    expect(welcomeFields('resync', body)).toEqual({});
  });
});

describe('two unseen digests', () => {
  it('attaches only the latest and does not send it again', async () => {
    const store = new MemoryDigestStore();
    const older = emptyDigest(COLONY, '2026-11-09T10:00:00.000Z');
    older.durationS = 10;
    older.attacks.count = 1;
    const newer = emptyDigest(COLONY, '2026-11-09T11:00:00.000Z');
    newer.durationS = 50;
    newer.attacks.count = 7;
    newer.resources['metals.t1'] = { before: 4, after: 9 };
    newer.built = [{ kind: 'hq', tier: 1, count: 2 }];
    newer.lost = [{ kind: 'turret', tier: 1, count: 1, cause: 'raid' }];
    newer.alerts = [
      { code: 'power_deficit', message: 'low power' },
      { code: 'storage_full', message: 'full' },
      { code: 'rocket_ready', message: 'x'.repeat(80) },
      { code: 'supply_cap', message: 'cap' },
    ];
    await close(store, older, '2026-11-09T10:00:00.000Z', '2026-11-09T10:10:00.000Z');
    await close(store, newer, '2026-11-09T11:00:00.000Z', '2026-11-09T11:10:00.000Z');
    const at = new Date('2026-11-09T12:00:00.000Z');
    const svc = new AwayDigestService({ store, now: () => at });
    const summary = await svc.headline(COLONY, at);
    expect(summary).toMatchObject({ durationS: 50, built: 2, lost: 1, attacks: 7, repelled: 0 });
    expect(summary?.resourcesNet['metals.t1']).toBe(5);
    expect(summary?.alerts).toEqual(['low power', 'full', 'x'.repeat(64)]);
    const body = await svc.deliverWelcome(COLONY, at);
    expect(body?.attacks.count).toBe(7);
    expect(body?.durationS).toBe(50);
    expect(welcomeMessage(body).d.away?.attacks.count).toBe(7);
    expect(await svc.deliverWelcome(COLONY, at)).toBeNull();
    expect(await store.listUnseen(COLONY)).toEqual([]);
  });

  it('omits awaySummary when the digest read misses the budget', async () => {
    const home = activeHome();
    const out = await attachAwaySummary(home, { headline: () => new Promise(() => undefined) }, 20);
    expect(out).toBe(home);
    expect(out).not.toHaveProperty('awaySummary');
  });
});
