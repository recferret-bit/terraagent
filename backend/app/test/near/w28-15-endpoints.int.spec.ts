import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { StakingActionResponse, StakingStatusResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { StakingService } from '../../src/near/staking/staking.service';
import { devPlayerId } from '../../src/ws/session-verifier';

/** W28-15: adversarial economics through the real endpoints (wallet-first, NEAR_MODE=mock). */
const POOL = 'astro-stakers.pool.mock';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const PROTOCOL = 'protocol.terraagent.mock';

let db: TestDatabase;
let app: INestApplication;
let url: string;
let staking: StakingService;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'w28-15-jwt-secret-0123456789abcdef', MOCK_LATENCY_MIN_MS: '0', MOCK_LATENCY_MAX_MS: '0', TA_WAVES: 'all',
    },
  });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  staking = app.get(StakingService, { strict: false });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

async function linkWallet(name: string): Promise<{ accountId: string; auth: Record<string, string> }> {
  const accountId = `${name}.near`;
  await db.prisma.socialIdentity.create({ data: { id: `si_${name}`, playerId: devPlayerId(name), provider: 'near', subject: accountId, accountId } });
  return { accountId, auth: { authorization: `Bearer dev:${name}` } };
}

async function post<T = Record<string, unknown>>(path: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
}
const perksOf = async (query: string) => StakingStatusResponse.parse(await (await fetch(`${url}/v1/near/staking?${query}`)).json()).perks as Record<string, unknown>;
const near = (n: string) => Number(n);

describe('W28-15 flash-stake snipe end to end ($50,000 = 12,500 NEAR at $4)', () => {
  it('sniper: 65 bp until the 24h mark, then 25 bp; unstaking inside 7 days pays 25 bp (31.25 NEAR) to the protocol and drops to Tier 0', async () => {
    const { accountId, auth } = await linkWallet('sniper');
    await staking.fundWalletNear(accountId, '12500');
    const staked = StakingActionResponse.parse((await post('/v1/near/stake', { accountId, pool: POOL, amount: '12500' }, auth)).body);
    expect(staked.perks).toMatchObject({ tier: 4, feeTier: 1, platformFeeBp: 65 });

    staking.advanceClockMs(DAY - 5_000); // 5 s before the warmup ends: still 65 bp
    expect(await perksOf(`accountId=${accountId}`)).toMatchObject({ tier: 4, platformFeeBp: 65 });
    staking.advanceClockMs(10_000); // past 24h: the full Tier 4 fee is live
    expect(await perksOf(`accountId=${accountId}`)).toMatchObject({ tier: 4, platformFeeBp: 25, earlyExitFeeBp: 25 });

    const protocolBefore = near(await staking.readWalletBalanceNear(PROTOCOL));
    const out = StakingActionResponse.parse((await post('/v1/near/unstake', { accountId, pool: POOL, amount: '12500' }, auth)).body);
    expect(out.earlyExitFeeBp).toBe(25);
    expect(near(out.earlyExitFeeNear!)).toBeCloseTo(31.25, 6); // 0.25 % of 12,500 NEAR = $125
    expect(near(await staking.readWalletBalanceNear(PROTOCOL)) - protocolBefore).toBeGreaterThanOrEqual(31.25 - 1e-9);
    expect(out.perks).toMatchObject({ tier: 0, platformFeeBp: 100 });
  });

  it('patient staker (waits past 7 days) unstakes for free: the exit fee is exactly what separates the two', async () => {
    const { accountId, auth } = await linkWallet('patient');
    await staking.fundWalletNear(accountId, '12500');
    await post('/v1/near/stake', { accountId, pool: POOL, amount: '12500' }, auth);
    staking.advanceClockMs(8 * DAY);
    expect(await perksOf(`accountId=${accountId}`)).toMatchObject({ platformFeeBp: 25, earlyExitFeeBp: 0 });
    const out = StakingActionResponse.parse((await post('/v1/near/unstake', { accountId, pool: POOL, amount: '12500' }, auth)).body);
    expect([out.earlyExitFeeBp, out.earlyExitFeeNear]).toEqual([0, '0']);
  });

  it('a top-up restarts the 7-day exit clock but never the 24h warmup of the existing stake (corner)', async () => {
    const { accountId, auth } = await linkWallet('topup');
    await staking.fundWalletNear(accountId, '300');
    await post('/v1/near/stake', { accountId, pool: POOL, amount: '200' }, auth);
    staking.advanceClockMs(8 * DAY);
    await post('/v1/near/stake', { accountId, pool: POOL, amount: '100' }, auth);
    const p = await perksOf(`accountId=${accountId}`);
    expect(p).toMatchObject({ tier: 3, platformFeeBp: 35, earlyExitFeeBp: 25 });
    staking.advanceClockMs(7 * DAY + HOUR);
    expect(await perksOf(`accountId=${accountId}`)).toMatchObject({ earlyExitFeeBp: 0 });
  });
});

describe('W28-15 King-of-the-Hill through POST /v1/near/staking/patron/nominate', () => {
  const nominate = (w: { accountId: string; auth: Record<string, string> }, planetId: string) =>
    post<{ isLeadPatron: boolean; leadPatron: { accountId: string } | null }>('/v1/near/staking/patron/nominate', { accountId: w.accountId, planetId }, w.auth);

  it('550 overtakes 500, a tie keeps the incumbent, unstaking below the runner-up hands the seat over, a switch vacates the old planet', async () => {
    for (const id of ['pl_koth_a', 'pl_koth_b']) await db.prisma.planet.create({ data: { id, name: id } });
    const a = await linkWallet('koth-a');
    const b = await linkWallet('koth-b');
    await staking.fundWalletNear(a.accountId, '700');
    await staking.fundWalletNear(b.accountId, '700');
    await post('/v1/near/stake', { accountId: a.accountId, pool: POOL, amount: '500' }, a.auth);
    expect((await nominate(a, 'pl_koth_a')).body.isLeadPatron).toBe(true);

    await post('/v1/near/stake', { accountId: b.accountId, pool: POOL, amount: '500' }, b.auth);
    const tie = await nominate(b, 'pl_koth_a');
    expect(tie.body).toMatchObject({ isLeadPatron: false, leadPatron: { accountId: a.accountId } }); // exact tie: incumbent keeps it

    await post('/v1/near/stake', { accountId: b.accountId, pool: POOL, amount: '50' }, b.auth); // 550 vs 500
    const over = await nominate(b, 'pl_koth_a');
    expect(over.body).toMatchObject({ isLeadPatron: true, leadPatron: { accountId: b.accountId } });

    // b unstakes to 499: the seat goes back to a at once, and b's own re-nomination to another planet finds no seat
    await post('/v1/near/unstake', { accountId: b.accountId, pool: POOL, amount: '51' }, b.auth);
    const back = await nominate(a, 'pl_koth_a');
    expect(back.body).toMatchObject({ isLeadPatron: true, leadPatron: { accountId: a.accountId } });
    expect((await nominate(b, 'pl_koth_b')).body.isLeadPatron).toBe(false);

    // a switches planets: pl_koth_a is vacated (b is below 500 everywhere), pl_koth_b becomes a's
    expect((await nominate(a, 'pl_koth_b')).body).toMatchObject({ isLeadPatron: true, leadPatron: { accountId: a.accountId } });
    expect(await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: 'pl_koth_a' } })).toBeNull();
    expect((await db.prisma.stakingPatronSeat.findUniqueOrThrow({ where: { planetId: 'pl_koth_b' } })).accountId).toBe(a.accountId);
  });

  it('nominating needs the wallet owner, and 499.999999 NEAR never takes the seat', async () => {
    await db.prisma.planet.create({ data: { id: 'pl_koth_c', name: 'c' } });
    const w = await linkWallet('koth-c');
    const mallory = await linkWallet('koth-mallory');
    await staking.fundWalletNear(w.accountId, '500');
    await post('/v1/near/stake', { accountId: w.accountId, pool: POOL, amount: '499.999999' }, w.auth);
    expect((await nominate(w, 'pl_koth_c')).body.isLeadPatron).toBe(false);
    expect((await post('/v1/near/staking/patron/nominate', { accountId: w.accountId, planetId: 'pl_koth_c' }, mallory.auth)).status).toBe(403);
    expect(await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: 'pl_koth_c' } })).toBeNull();
  });
});

describe('W28-15 multi-colony Sybil over HTTP: colonies add nothing to a wallet', () => {
  it('10 colonies of one Tier 2 wallet all read the same wallet perks as the bare wallet', async () => {
    const w = await linkWallet('sybil');
    await staking.fundWalletNear(w.accountId, '50');
    await post('/v1/near/stake', { accountId: w.accountId, pool: POOL, amount: '50' }, w.auth);
    staking.advanceClockMs(2 * DAY);
    for (let i = 0; i < 10; i++) {
      await db.prisma.nearColonyAccount.create({
        data: { accountId: `c${i}.sybil.near`, playerId: devPlayerId('sybil'), slot: `sy${i}`, colonyId: `col_sy${i}`, ownerAccountId: w.accountId, publicKey: 'ed25519:t', encryptedSecret: 'x', kekVersion: 1 },
      });
    }
    const wallet = await perksOf(`accountId=${w.accountId}`);
    expect(wallet).toMatchObject({ tier: 2, maxAiColonySlots: 3, gasMultiplier: 4 });
    for (let i = 0; i < 10; i++) {
      const p = await perksOf(`accountId=c${i}.sybil.near`);
      expect([p.tier, p.maxAiColonySlots, p.gasMultiplier, p.dailyAiCallLimit]).toEqual([wallet.tier, wallet.maxAiColonySlots, wallet.gasMultiplier, wallet.dailyAiCallLimit]);
    }
  });
});
