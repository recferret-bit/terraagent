import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { CANONICAL_PLANETS, StakerPerksResponse, StakingPrestigeResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { nearToYocto } from '../../src/near/staking/yocto';

const POOL = 'astro-stakers.pool.mock';
const PLANET = CANONICAL_PLANETS.desert.id;
const apps: INestApplication[] = [];
let db: TestDatabase;
let urlOn: string;
let urlOff: string;

beforeAll(async () => {
  db = await createTestDatabase();
  urlOn = await boot('all');
  urlOff = await boot('..27');
}, 180_000);
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await db?.drop();
});

async function boot(waves: string) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef',
      DATABASE_URL: db.url,
      TA_WAVES: waves,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  return (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
}

async function seedWhale(name: string, near: number, ageMs: number) {
  const now = Date.now();
  await db.prisma.nearColonyAccount.create({
    data: { accountId: `${name}.near`, playerId: `p-${name}`, slot: `s-${name}`, colonyId: `col_${name}`, ownerAccountId: `${name}.near`, publicKey: 'ed25519:t', encryptedSecret: 'x', kekVersion: 1 },
  });
  await db.prisma.stakingPosition.create({
    data: { colonyId: `col_${name}`, poolId: POOL, accountId: `${name}.near`, stakedSnapshot: nearToYocto(near), stakedSinceAt: new Date(now - ageMs), lastStakedAt: new Date(now - ageMs) },
  });
  await db.prisma.stakingPatronNomination.create({ data: { accountId: `${name}.near`, planetId: PLANET } });
}

describe('W28-03 GET /v1/near/staking/perks and /prestige', () => {
  it('serves the wallet perks card with W28 on, shaped by StakerPerksResponse', async () => {
    const url = urlOn;
    await seedWhale('alice', 210, 3 * 86_400_000);
    const res = await fetch(`${url}/v1/near/staking/perks?accountId=alice.near`);
    expect(res.status).toBe(200);
    const body = StakerPerksResponse.parse(await res.json());
    expect(body.accountId).toBe('alice.near');
    expect(body.perks).toMatchObject({ version: 2, tier: 3, platformFeeBp: 35, maxAiColonySlots: 6, daoVoteWeightBp: 15_000 });
    expect(body.aiBudget).toMatchObject({ colonySlotsMax: 6, mode: 'tee', model: 'z-ai/glm-5.3-flash' });
    expect(body.aiBudget.dailyCallLimit).toBe(body.perks.dailyAiCallLimit);

    const byColony = StakerPerksResponse.parse(await (await fetch(`${url}/v1/near/staking/perks?colonyId=col_alice`)).json());
    expect(byColony.perks).toEqual(body.perks);
  });

  it('answers a Cadet card for an unknown wallet, unlinked bearer session, and 400 without any query', async () => {
    const url = urlOn;
    const cadet = StakerPerksResponse.parse(await (await fetch(`${url}/v1/near/staking/perks?accountId=nobody.near`)).json());
    expect(cadet.perks).toMatchObject({ tier: 0, platformFeeBp: 100, maxAiColonySlots: 0, aiMode: 'script' });
    const devRes = await fetch(`${url}/v1/near/staking/perks`, { headers: { authorization: 'Bearer dev:a' } });
    expect(devRes.status, await devRes.clone().text()).toBe(200);
    const devBody = StakerPerksResponse.parse(await devRes.json());
    expect(devBody.accountId).toBeNull();
    expect(devBody.perks).toMatchObject({ tier: 0, platformFeeBp: 100, maxAiColonySlots: 0, aiMode: 'script' });
    expect((await fetch(`${url}/v1/near/staking/perks`)).status).toBe(400);
    expect((await fetch(`${url}/v1/near/staking/prestige`)).status).toBe(400);
  });

  it('prestige: lead patron plus per-colony tier for a planet', async () => {
    const url = urlOn;
    await seedWhale('bob', 600, 2 * 86_400_000);
    const body = StakingPrestigeResponse.parse(await (await fetch(`${url}/v1/near/staking/prestige?planetId=${PLANET}`)).json());
    expect(body.leadPatron).toMatchObject({
      planetId: PLANET,
      accountId: 'bob.near',
      carrierName: 'ISS bob.near',
      protocolFeeShareBp: 1_500,
      activeStakedNear: '600',
    });
    const empty = StakingPrestigeResponse.parse(await (await fetch(`${url}/v1/near/staking/prestige?planetId=planet-none`)).json());
    expect(empty).toEqual({ planetId: 'planet-none', leadPatron: null, colonies: [] });
  });

  it('both endpoints are 404 when W28 is off (TA_WAVES=..27)', async () => {
    const url = urlOff;
    expect((await fetch(`${url}/v1/near/staking/perks?accountId=alice.near`)).status).toBe(404);
    expect((await fetch(`${url}/v1/near/staking/prestige?planetId=${PLANET}`)).status).toBe(404);
  });
});
