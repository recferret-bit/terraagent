import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { DEV_PLANET_CAPACITY, DEV_PLANET_RADIUS } from '@terra/sim';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HomeRepository } from '../../src/core/home/home.repository';
import type { AppEnv } from '../../src/core/tokens';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });
beforeEach(async () => {
  await db.prisma.colony.deleteMany({});
  await db.prisma.planet.deleteMany({});
});

const env = { NODE_ENV: 'test', SNAPSHOTS: 'on', DATABASE_URL: 'set' } as unknown as AppEnv;
const repo = () => new HomeRepository(db.prisma as never, env);
const colony = (planetId: string, colonyIndex: number, playerId = `p_${planetId}_${colonyIndex}`) =>
  ({ playerId, planetId, colonyIndex, name: `C${colonyIndex}`, spawnQ: colonyIndex, spawnR: -colonyIndex });

// XC-18: the Postgres seat paths of `HomeRepository` (`PrismaHomeStore`): capacity, seat counts, rollback, retype.
describe('HomeRepository on Postgres (PrismaHomeStore)', () => {
  it('fills a dev planet up to its capacity, then opens the next of the family; seat counts follow the rows', async () => {
    const r = repo();
    for (let i = 0; i < DEV_PLANET_CAPACITY; i++) {
      const open = await r.findOrCreateOpenDevPlanet('desert');
      expect(open).toMatchObject({ planet: { id: 'pl_dev', type: 'desert', radius: DEV_PLANET_RADIUS, capacity: DEV_PLANET_CAPACITY }, colonyIndex: i });
      const { planet } = await r.createColony(colony('pl_dev', i));
      expect(planet.seatsTaken).toBe(i + 1);
    }
    expect(await r.findOrCreateOpenDevPlanet('desert')).toMatchObject({ planet: { id: 'pl_dev_2', seatsTaken: 0 }, colonyIndex: 0 });
    expect((await db.prisma.planet.findMany({ orderBy: { id: 'asc' } })).map((p) => [p.id, p.seatsTaken])).toEqual([['pl_dev', 5], ['pl_dev_2', 0]]);
  });

  it('a rolled-back seat frees its index and recounts the planet; a second row at a taken index is refused', async () => {
    const r = repo();
    await r.upsertDevPlanet('pl_dev');
    const { colony: first } = await r.createColony(colony('pl_dev', 0));
    await expect(r.createColony(colony('pl_dev', 0, 'p_other'))).rejects.toThrow(); // @@unique([planetId, colonyIndex])
    await r.deleteColony(first.id);
    expect((await r.findPlanetById('pl_dev'))?.seatsTaken).toBe(0);
    expect(await r.findOrCreateOpenDevPlanet('desert')).toMatchObject({ planet: { id: 'pl_dev' }, colonyIndex: 0 });
  });

  it('retypes an empty pre-D-38 dev planet row, never one with colonies (D-38)', async () => {
    await db.prisma.planet.create({ data: { id: 'pl_dev', name: 'Dev Planet', type: 'temperate', seed: 'golden-1', state: 'ACTIVE', capacity: 5, seatsTaken: 0 } });
    await db.prisma.planet.create({ data: { id: 'pl_dev_2', name: 'Dev Planet 2', type: 'temperate', seed: 'golden-1', state: 'ACTIVE', capacity: 5, seatsTaken: 1 } });
    await db.prisma.colony.create({ data: { id: 'co_keep', ...colony('pl_dev_2', 0), color: 0, status: 'ACTIVE' } });
    const r = repo();
    expect(await r.upsertDevPlanet('pl_dev')).toMatchObject({ id: 'pl_dev', type: 'desert' });
    expect(await r.upsertDevPlanet('pl_dev_2')).toMatchObject({ id: 'pl_dev_2', type: 'temperate' });
  });

  it('answers colonies by player and planet, status changes and a planet wipe from the database, not a stale cache', async () => {
    const writer = repo();
    await writer.upsertDevPlanet('pl_dev');
    const { colony: c } = await writer.createColony(colony('pl_dev', 0, 'p_a'));
    await writer.setColonyStatus(c.id, 'ELIMINATED');
    const reader = repo(); // another process: empty cache
    expect(await reader.findColonyByPlayerAndPlanet('p_a', 'pl_dev')).toMatchObject({ id: c.id, status: 'ELIMINATED' });
    expect(await reader.findLatestColonyByPlayerId('p_a')).toMatchObject({ id: c.id });
    expect(await reader.deleteColoniesOfPlanet('pl_dev')).toBe(1);
    expect(await reader.findColonyById(c.id)).toBeNull();
    expect((await reader.findPlanetById('pl_dev'))?.seatsTaken).toBe(0);
    expect(await reader.setPlanetStatus('pl_dev', 'ENDED')).toMatchObject({ status: 'ENDED' });
  });
});
