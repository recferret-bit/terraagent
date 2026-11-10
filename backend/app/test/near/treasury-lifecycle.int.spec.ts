import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/event-bus';
import { FlagsService } from '../../src/flags/flags.service';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter';
import { PlanetDaoLifecycleBind } from '../../src/near/treasury/lifecycle.bind';
import { daoCreateOpId } from '../../src/near/treasury/lifecycle';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

function serviceFor(taWaves: string): PlanetDaoLifecycleService {
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: taWaves };
  const flags = new FlagsService(env as never);
  const dao = new MockTreasuryDaoAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 5 },
    { sleep: async () => undefined },
  );
  return new PlanetDaoLifecycleService(flags, dao, new ChainOutboxRepository(db.prisma), db.prisma, env as never);
}

async function daoRow(accountId: string) {
  return db.prisma.mockChainDao.findUnique({ where: { id: accountId }, include: { proposals: true } });
}

describe('W22-05 planet DAO lifecycle', () => {
  it('ensure on a new planet id creates one DAO whose account ends with .dao.mock', async () => {
    const lifecycle = serviceFor('..22');
    const opened = await lifecycle.ensurePlanetDao('kharon');
    expect(opened?.daoAccountId.endsWith('.dao.mock')).toBe(true);
    expect(opened).toMatchObject({ planetId: 'kharon', daoAccountId: 'kharon.dao.mock', opId: 'dao-create:kharon' });

    const row = await daoRow('kharon.dao.mock');
    expect(row?.proposals).toEqual([]);
    expect(row?.policy).toMatchObject({ name: 'kharon', members: [] });
    const outbox = await db.prisma.chainOutbox.findUnique({ where: { opId: 'dao-create:kharon' } });
    expect(outbox).toMatchObject({ port: 'TreasuryDao', method: 'createDao', status: 'DONE' });
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'dao-create:kharon' } })).toBe(1);
  });

  it('creates nothing when W22 is off', async () => {
    const lifecycle = serviceFor('..21');
    expect(await lifecycle.ensurePlanetDao('old.planet')).toBeNull();
    expect(await daoRow('old.planet.dao.mock')).toBeNull();
    expect(await db.prisma.chainOutbox.findUnique({ where: { opId: daoCreateOpId('old.planet') } })).toBeNull();
  });

  it('two ensures open one proposal-less DAO, and a dotted planet id round-trips', async () => {
    const lifecycle = serviceFor('..22');
    const planetId = 'dune.alpha';
    const [first, second] = await Promise.all([
      lifecycle.ensurePlanetDao(planetId),
      lifecycle.ensurePlanetDao(planetId),
    ]);
    const third = await lifecycle.ensurePlanetDao(planetId);
    expect(first?.daoAccountId).toBe('dune.alpha.dao.mock');
    expect(second?.daoAccountId).toBe(first?.daoAccountId);
    expect(third?.daoAccountId).toBe(first?.daoAccountId);
    expect(first?.opId).toBe('dao-create:dune.alpha');

    const row = await daoRow('dune.alpha.dao.mock');
    expect(row?.proposals).toEqual([]);
    expect(row?.policy).toMatchObject({ name: 'dune.alpha', members: [] });
    expect(await db.prisma.mockChainDao.count({ where: { id: 'dune.alpha.dao.mock' } })).toBe(1);
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'dao-create:dune.alpha' } })).toBe(1);
    expect(await db.prisma.chainOutbox.count({ where: { opId: 'dao-create:dune.alpha' } })).toBe(1);
  });

  it('opens one DAO when the sim planet loads or the first colony is founded', async () => {
    const lifecycle = serviceFor('..22');
    const bus = new EventBus();
    const loaded: Array<(planetId: string) => void> = [];
    const planets = { onPlanetLoaded(fn: (planetId: string) => void) { loaded.push(fn); } };
    const bind = new PlanetDaoLifecycleBind(lifecycle, bus, planets as never);
    bind.onModuleInit();

    loaded[0]!('pl_sim_load');
    bus.emit('planet.event', {
      planetId: 'pl_founded',
      tick: 3,
      kind: 'colonyFounded',
      severity: 'info',
      colonyIds: ['co_founded'],
      data: { colonyId: 'co_founded', playerId: 'player_founded' },
    });
    bus.emit('planet.event', {
      planetId: 'pl_founded',
      tick: 4,
      kind: 'colonyFounded',
      severity: 'info',
      colonyIds: ['co_founded_2'],
      data: { colonyId: 'co_founded_2', playerId: 'player_founded_2' },
    });

    await vi.waitFor(async () => {
      expect(await daoRow('pl_sim_load.dao.mock')).not.toBeNull();
      expect(await daoRow('pl_founded.dao.mock')).not.toBeNull();
    });
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: daoCreateOpId('pl_founded') } })).toBe(1);
    expect((await daoRow('pl_founded.dao.mock'))?.proposals).toEqual([]);

    bind.onModuleDestroy();
    loaded[0]!('pl_after_stop');
    bus.emit('planet.event', {
      planetId: 'pl_after_stop',
      tick: 5,
      kind: 'colonyFounded',
      severity: 'info',
      colonyIds: ['co_after'],
      data: { colonyId: 'co_after' },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(await daoRow('pl_after_stop.dao.mock')).toBeNull();
  });
});
