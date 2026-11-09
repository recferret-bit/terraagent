import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyDigest } from '../../src/game/digest/body';
import { PrismaDigestStore } from '../../src/game/digest/prisma-store';
import { AwayDigestService } from '../../src/game/digest/service';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FBV';
const PLANET = 'pl_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const DAY_MS = 86_400_000;

const away = (tick = 1) => ({
  planetId: PLANET,
  tick,
  kind: 'colonyAway',
  colonyIds: [COLONY],
  data: { colonyId: COLONY, atTick: tick },
});
const raid = (tick: number) => ({
  planetId: PLANET,
  tick,
  kind: 'raidStarted',
  colonyIds: [COLONY],
  data: { colonyId: COLONY, species: `R${tick}`, q: 1, r: 1 },
});

let db: TestDatabase;
let store: PrismaDigestStore;

beforeAll(async () => {
  db = await createTestDatabase();
  store = new PrismaDigestStore(db.prisma);
});

beforeEach(async () => {
  await db.prisma.planetEventDigest.deleteMany();
});

afterAll(async () => {
  await db?.drop();
});

describe('away digest on Postgres', () => {
  it('inserts, flushes, and reloads the body so a second raid reaches count 2', async () => {
    const t = Date.parse('2026-11-09T12:00:00.000Z');
    const now = () => new Date(t);
    const first = new AwayDigestService({ store, now });
    await first.onPlanetEvent(away());
    await first.onPlanetEvent(raid(1));
    await first.flushPlanet(PLANET);
    const flushed = await db.prisma.planetEventDigest.findFirstOrThrow({ where: { colonyId: COLONY } });
    expect((flushed.body as { attacks: { count: number } }).attacks.count).toBe(1);

    const restarted = new AwayDigestService({ store, now });
    await restarted.restoreOpen();
    await restarted.onPlanetEvent(raid(2));
    await restarted.flushPlanet(PLANET);
    const reloaded = await store.findOpen(COLONY);
    expect(reloaded?.body.attacks.count).toBe(2);
    expect(reloaded?.body.attacks.byColony.map((row) => row.displayName)).toEqual(['R1', 'R2']);
    expect(await db.prisma.planetEventDigest.count({ where: { colonyId: COLONY, closedAt: null } })).toBe(1);
  });

  it('purges a row opened 7 days + 1 ms ago and keeps one opened exactly 7 days ago', async () => {
    const now = new Date('2026-11-09T00:00:00.000Z');
    const exact = new Date(now.getTime() - 7 * DAY_MS);
    const older = new Date(exact.getTime() - 1);
    const body = emptyDigest(COLONY, exact.toISOString());
    await store.insert({ colonyId: COLONY, planetId: PLANET, openedAt: exact, lastEventSeq: 0n, body });
    await store.insert({
      colonyId: OTHER,
      planetId: PLANET,
      openedAt: older,
      lastEventSeq: 0n,
      body: emptyDigest(OTHER, older.toISOString()),
    });
    await store.insert({
      colonyId: COLONY,
      planetId: PLANET,
      openedAt: now,
      lastEventSeq: 0n,
      body: emptyDigest(COLONY, now.toISOString()),
    });
    const svc = new AwayDigestService({ store, now: () => now });
    expect(await svc.purge(now)).toBe(1);
    const left = await db.prisma.planetEventDigest.findMany({ orderBy: { openedAt: 'asc' } });
    expect(left.map((row) => row.openedAt.getTime())).toEqual([exact.getTime(), now.getTime()]);
  });

  it('merges older unseen rows into the newest and marks them seen', async () => {
    let t = Date.parse('2026-11-09T12:00:00.000Z');
    const svc = new AwayDigestService({ store, now: () => new Date(t) });
    await svc.onPlanetEvent(away(1));
    await svc.onPlanetEvent(raid(1));
    t += 60_000;
    await svc.onPlanetEvent({
      planetId: PLANET,
      tick: 2,
      kind: 'colonyBack',
      colonyIds: [COLONY],
      data: { colonyId: COLONY, atTick: 2 },
    });
    t += 1_000;
    await svc.onPlanetEvent(away(3));
    await svc.onPlanetEvent(raid(4));
    await svc.flushPlanet(PLANET);
    const unseen = await store.listUnseen(COLONY);
    expect(unseen).toHaveLength(1);
    expect(unseen[0]?.body.attacks.count).toBe(2);
    const seen = await db.prisma.planetEventDigest.findMany({ where: { colonyId: COLONY, seenAt: { not: null } } });
    expect(seen).toHaveLength(1);
    expect((seen[0]?.body as { attacks: { count: number } }).attacks.count).toBe(1);
  });
});
