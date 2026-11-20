import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { MARKET_TOKENS, StakerPerksResponse, StakingPrestigeResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { EventBus } from '../../src/bus/event-bus';
import {
  W28_PILOT_USDC_ATOMIC,
  W28_RIVAL_ACCOUNT,
  W28ScenarioSeedService,
  w28PilotAccountId,
} from '../../src/near/infrastructure/dev/w28-scenario-seed.service';
import { devPlayerId } from '../../src/ws/session-verifier';

let db: TestDatabase;
const apps: INestApplication[] = [];

async function boot(waves: string) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'w28-seed-jwt-secret-0123456789abcdef', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0',
      TA_WAVES: waves,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { url, bus: created.app.get(EventBus, { strict: false }), seed: created.app.get(W28ScenarioSeedService, { strict: false }) };
}

const json = async <T>(url: string): Promise<{ status: number; body: T }> => {
  const res = await fetch(url);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
};

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await db?.drop();
});

describe('W28-16 scenario seed (w28)', () => {
  it('seeds a 500 NEAR rival Lead Patron and a funded, linked, verified pilot wallet; reseeding is repeatable', async () => {
    const { url, bus, seed } = await boot('all');
    await db.prisma.planet.create({ data: { id: 'pl_w28_demo', name: 'W28 Demo' } });
    const playerId = devPlayerId('w28');
    const pilot = w28PilotAccountId(playerId);
    expect(pilot).toMatch(/^w28-[0-9a-f]{10}\.terraagent\.mock$/);

    for (let run = 0; run < 2; run += 1) {
      bus.emit('dev.scenario.created', { planetId: 'pl_w28_demo', scenario: 'w28' } as never);
      bus.emit('dev.scenario.seated', { planetId: 'pl_w28_demo', playerId, colonyIndex: 0 } as never);
      await seed.waitForSeed();
    }

    const identities = await db.prisma.socialIdentity.findMany({ where: { playerId } });
    expect(identities.map((i) => i.accountId)).toEqual([pilot]);
    const usdc = await db.prisma.mockChainIntentsBalance.findFirstOrThrow({ where: { accountId: pilot, tokenId: MARKET_TOKENS.USDC.verifierId } });
    expect(usdc.amount.toFixed()).toBe(W28_PILOT_USDC_ATOMIC.toString()); // reset, not doubled, on reseed

    const pilotPerks = await json<unknown>(`${url}/v1/near/staking/perks?accountId=${pilot}`);
    expect(pilotPerks.status).toBe(200);
    expect(StakerPerksResponse.parse(pilotPerks.body).perks.tier).toBe(0);
    expect(StakerPerksResponse.parse(pilotPerks.body).aiBudget.trialEligible).toBe(true);

    const rival = StakerPerksResponse.parse((await json(`${url}/v1/near/staking/perks?accountId=${W28_RIVAL_ACCOUNT}`)).body);
    expect(rival.perks.tier).toBe(4);
    expect(rival.perks.activeStakedNear).toBe('500');

    const prestige = StakingPrestigeResponse.parse((await json(`${url}/v1/near/staking/prestige?planetId=pl_w28_demo`)).body);
    expect(prestige.leadPatron?.accountId).toBe(W28_RIVAL_ACCOUNT);
    expect(prestige.leadPatron?.carrierName).toContain('w28-rival');
  });

  it('a second seat event for the same pilot (page reload / reconnect) does not reset the wallet (corner)', async () => {
    const { bus, seed } = await boot('all');
    await db.prisma.planet.create({ data: { id: 'pl_w28_reload', name: 'W28 Reload' } });
    const playerId = devPlayerId('w28reload');
    bus.emit('dev.scenario.created', { planetId: 'pl_w28_reload', scenario: 'w28' } as never);
    bus.emit('dev.scenario.seated', { planetId: 'pl_w28_reload', playerId, colonyIndex: 0 } as never);
    await seed.waitForSeed();
    const pilot = w28PilotAccountId(playerId);
    await db.prisma.aiFreeTrial.create({ data: { playerId, turnsUsed: 3 } });
    bus.emit('dev.scenario.seated', { planetId: 'pl_w28_reload', playerId, colonyIndex: 0 } as never);
    await seed.waitForSeed();
    expect((await db.prisma.aiFreeTrial.findUnique({ where: { playerId } }))?.turnsUsed).toBe(3);
    expect(await db.prisma.socialIdentity.count({ where: { playerId, accountId: pilot, provider: 'near-wallet' } })).toBe(1);
  });

  it('ignores other scenarios and seats on planets it did not create (negative)', async () => {
    const { bus, seed } = await boot('all');
    const playerId = devPlayerId('w28other');
    bus.emit('dev.scenario.created', { planetId: 'pl_other', scenario: 'w22' } as never);
    bus.emit('dev.scenario.seated', { planetId: 'pl_other', playerId, colonyIndex: 0 } as never);
    await seed.waitForSeed();
    expect(await db.prisma.socialIdentity.count({ where: { playerId } })).toBe(0);
  });

  it('is a no-op with W28 off (TA_WAVES=..27)', async () => {
    const { bus, seed } = await boot('..27');
    await db.prisma.planet.create({ data: { id: 'pl_w28_off', name: 'W28 Off' } });
    const playerId = devPlayerId('w28off');
    bus.emit('dev.scenario.created', { planetId: 'pl_w28_off', scenario: 'w28' } as never);
    bus.emit('dev.scenario.seated', { planetId: 'pl_w28_off', playerId, colonyIndex: 0 } as never);
    await seed.waitForSeed();
    expect(await db.prisma.socialIdentity.count({ where: { playerId } })).toBe(0);
    expect(await db.prisma.stakingPatronSeat.count({ where: { planetId: 'pl_w28_off' } })).toBe(0);
  });
});
