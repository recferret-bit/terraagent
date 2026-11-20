import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { MARKET_TOKENS, StakeProfitsResponse, StakingActionResponse, StakingStatusResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { creditVerifier } from '../../src/near/infrastructure/adapters/mock/intents-ledger';
import { StakingService } from '../../src/near/staking/staking.service';
import { devPlayerId } from '../../src/ws/session-verifier';

const POOL = 'astro-stakers.pool.mock';
const DAY = 86_400_000;
const PROTOCOL = 'protocol.terraagent.mock';

let db: TestDatabase;
const apps: INestApplication[] = [];

async function boot(waves: string) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'wallet-first-jwt-secret-0123456789abcdef',
      MOCK_LATENCY_MIN_MS: '0',
      MOCK_LATENCY_MAX_MS: '0',
      TA_WAVES: waves,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url, staking: created.app.get(StakingService, { strict: false }) };
}

/** A pilot whose session (`dev:<name>`) has linked the NEAR wallet `<name>.near`: no colony, no deed. */
async function linkWallet(name: string): Promise<{ accountId: string; auth: Record<string, string> }> {
  const accountId = `${name}.near`;
  await db.prisma.socialIdentity.create({
    data: { id: `si_${name}`, playerId: devPlayerId(name), provider: 'near', subject: accountId, accountId },
  });
  return { accountId, auth: { authorization: `Bearer dev:${name}` } };
}

async function post<T = Record<string, unknown>>(url: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const get = async <T>(url: string, path: string) => (await (await fetch(`${url}${path}`)).json()) as T;
const near = (n: string | number) => Number(n);

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await db?.drop();
});

describe('W28-04 wallet-first staking over HTTP (NEAR_MODE=mock, zero colonies)', () => {
  it('stake -> warmup -> compound -> early unstake -> withdraw -> stake USDC profits, all on a wallet with no colony', async () => {
    const { url, staking } = await boot('all');
    const { accountId, auth } = await linkWallet('alice');
    expect(await db.prisma.deed.count()).toBe(0);
    expect(await db.prisma.nearColonyAccount.count({ where: { colonyId: { not: null } } })).toBe(0);
    await staking.fundWalletNear(accountId, '60');

    // 50 NEAR: Tier 2, but the 50 bp fee needs the 24h warmup, so the 65 bp Tier 1 fee applies first.
    const staked = await post<StakingActionResponse>(url, '/v1/near/stake', { accountId, pool: POOL, amount: '50' }, auth);
    expect(staked.status).toBe(200);
    const s = StakingActionResponse.parse(staked.body);
    expect(s.position).toMatchObject({ accountId, pool: POOL, staked: '50' });
    expect(s.position.colonyId).toBeUndefined();
    expect(s.position.stakedSinceMs).toEqual(expect.any(Number));
    expect(s.walletBalanceNear).toBe('10');
    expect(s.perks).toMatchObject({ version: 2, tier: 2, feeTier: 1, platformFeeBp: 65 });
    expect((s.perks as { feeWarmupReadyAtMs: number }).feeWarmupReadyAtMs).toBeGreaterThan(0);

    // The read-model row is keyed by the wallet and mirrors the clocks.
    const row = await db.prisma.stakingPosition.findFirstOrThrow({ where: { accountId } });
    expect(row.colonyId).toBe(accountId);
    expect(row.stakedSinceAt?.getTime()).toBe(s.position.stakedSinceMs);
    expect(row.lastStakedAt?.getTime()).toBe(s.position.lastStakedAtMs);

    // 24h later the Tier 2 fee unlocks (status reads at the staking clock).
    staking.advanceClockMs(DAY + 1_000);
    const status = StakingStatusResponse.parse(await get(url, `/v1/near/staking?accountId=${accountId}`));
    expect(status.colonyId).toBeUndefined();
    expect(status.perks).toMatchObject({ tier: 2, feeTier: 2, platformFeeBp: 50, feeWarmupReadyAtMs: null });

    // Accrued yield compounds into principal; the 7-day clock does not move.
    const compounded = await post<StakingActionResponse>(url, '/v1/near/stake/compound', { accountId, pool: POOL }, auth);
    expect(compounded.status).toBe(200);
    const c = StakingActionResponse.parse(compounded.body);
    expect(near(c.compoundedNear!)).toBeGreaterThan(0);
    expect(near(c.position.staked)).toBeGreaterThan(50);
    expect(c.position.lastStakedAtMs).toBe(s.position.lastStakedAtMs);
    expect(c.position.stakedSinceMs).toBe(s.position.stakedSinceMs);

    // Unstake 45 inside 7 days: 25 bp (0.1125 NEAR) goes to the protocol and the tier drops at once.
    const protocolBefore = near(await staking.readWalletBalanceNear(PROTOCOL));
    const unstaked = await post<StakingActionResponse>(url, '/v1/near/unstake', { accountId, pool: POOL, amount: '45' }, auth);
    expect(unstaked.status).toBe(200);
    const u = StakingActionResponse.parse(unstaked.body);
    expect(u.earlyExitFeeBp).toBe(25);
    expect(u.earlyExitFeeNear).toBe('0.1125');
    expect(u.position.unbonding).toBe('44.8875');
    expect(u.perks).toMatchObject({ tier: 0, platformFeeBp: 100, maxAiColonySlots: 0 });
    expect(near(await staking.readWalletBalanceNear(PROTOCOL)) - protocolBefore).toBeGreaterThanOrEqual(0.1125);

    // Nothing unbonded yet: a clear 409 instead of a generic failure.
    const early = await post<{ errorCode: string }>(url, '/v1/near/withdraw', { accountId, pool: POOL }, auth);
    expect(early.status).toBe(409);
    expect(early.body.errorCode).toBe('NOTHING_TO_WITHDRAW');

    // Past unbonding: one step, the principal lands in the wallet.
    staking.advanceClockMs(2 * DAY + 1_000);
    const withdrawn = await post<StakingActionResponse>(url, '/v1/near/withdraw', { accountId, pool: POOL }, auth);
    expect(withdrawn.status).toBe(200);
    const w = StakingActionResponse.parse(withdrawn.body);
    expect(w.position.unbonding).toBe('0');
    expect(w.position.withdrawable).toBe('0');
    expect(near(w.walletBalanceNear)).toBeGreaterThanOrEqual(54.8875);

    // USDC trade profit: swapped to stNEAR at the cached price ($4) and staked, atomically.
    await creditVerifier(db.prisma, accountId, MARKET_TOKENS.USDC.verifierId, 25_000_000n);
    const quoted = await post<StakeProfitsResponse>(url, '/v1/near/stake/profits', { accountId, amountUsdc: '10', dry: true }, auth);
    expect(quoted.status).toBe(200);
    expect(StakeProfitsResponse.parse(quoted.body)).toMatchObject({ txHash: null, position: null, quote: { amountOutNear: '2.5', nearUsd: 4, dry: true } });
    expect((await db.prisma.mockChainIntentsBalance.findFirstOrThrow({ where: { accountId, tokenId: MARKET_TOKENS.USDC.verifierId } })).amount.toFixed()).toBe('25000000');

    const profits = await post<StakeProfitsResponse>(url, '/v1/near/stake/profits', { accountId, amountUsdc: '10' }, auth);
    expect(profits.status).toBe(200);
    const p = StakeProfitsResponse.parse(profits.body);
    expect(p.txHash).toEqual(expect.any(String));
    expect(p.quote).toMatchObject({ amountOutNear: '2.5', amountInAtomic: '10000000', dry: false });
    expect(p.position).toMatchObject({ asset: 'stNEAR', accountId });
    expect(near(p.position!.staked)).toBeGreaterThanOrEqual(7.5);
    expect((await db.prisma.mockChainIntentsBalance.findFirstOrThrow({ where: { accountId, tokenId: MARKET_TOKENS.USDC.verifierId } })).amount.toFixed()).toBe('15000000');

    const broke = await post<{ errorCode: string }>(url, '/v1/near/stake/profits', { accountId, amountUsdc: '100' }, auth);
    expect(broke.status).toBe(409);
    expect(broke.body.errorCode).toBe('INSUFFICIENT_USDC');
    expect((await db.prisma.mockChainIntentsBalance.findFirstOrThrow({ where: { accountId, tokenId: MARKET_TOKENS.USDC.verifierId } })).amount.toFixed()).toBe('15000000');

    const kinds = (await db.prisma.stakingTx.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } })).map((t) => t.kind);
    expect(kinds).toEqual(['stake', 'compound', 'unstake', 'early_exit_fee', 'withdraw', 'stake_profits']);
    const fee = await db.prisma.stakingTx.findFirstOrThrow({ where: { accountId, kind: 'early_exit_fee' } });
    expect(fee.amountYocto.toFixed()).toBe('112500000000000000000000');
  });
});

describe('W28-04 wallet-first staking: refusals and corners', () => {
  it('profits are paid from the USDC of the wallet\'s colony account when the wallet itself holds none', async () => {
    const { url, staking } = await boot('all');
    const { accountId, auth } = await linkWallet('frank');
    await db.prisma.nearColonyAccount.create({
      data: { accountId: 'col_f.frank.near', playerId: devPlayerId('frank'), slot: 'col_f', colonyId: 'col_f', ownerAccountId: accountId, publicKey: 'ed25519:t', encryptedSecret: 'x', kekVersion: 1 },
    });
    await creditVerifier(db.prisma, 'col_f.frank.near', MARKET_TOKENS.USDC.verifierId, 8_000_000n);
    const res = await post<StakeProfitsResponse>(url, '/v1/near/stake/profits', { accountId, amountUsdc: '8' }, auth);
    expect(res.status).toBe(200);
    expect(StakeProfitsResponse.parse(res.body).position).toMatchObject({ accountId, staked: '2', asset: 'stNEAR' });
    expect((await db.prisma.mockChainIntentsBalance.findFirstOrThrow({ where: { accountId: 'col_f.frank.near', tokenId: MARKET_TOKENS.USDC.verifierId } })).amount.toFixed()).toBe('0');
    expect(staking.isWalletFirst()).toBe(true);
  });

  it('rejects an empty compound (409 NOTHING_TO_COMPOUND) and a request with no wallet or colony (400 WALLET_REQUIRED)', async () => {
    const { url, staking } = await boot('all');
    const { accountId, auth } = await linkWallet('carol');
    const none = await post<{ errorCode: string }>(url, '/v1/near/stake/compound', { accountId, pool: POOL }, auth);
    expect(none.status).toBe(409);
    expect(none.body.errorCode).toBe('NOTHING_TO_COMPOUND');

    const noWallet = await post<{ errorCode: string }>(url, '/v1/near/stake/compound', { pool: POOL }, auth);
    expect(noWallet.status).toBe(400);
    expect(noWallet.body.errorCode).toBe('WALLET_REQUIRED');

    await staking.fundWalletNear(accountId, '5');
    const unfunded = await post<{ errorCode: string }>(url, '/v1/near/stake', { accountId, pool: POOL, amount: '50' }, auth);
    expect(unfunded.status).toBe(409);
    expect(unfunded.body.errorCode).toBe('STAKE_INSUFFICIENT_BALANCE');
    const badPool = await post<{ errorCode: string }>(url, '/v1/near/stake', { accountId, pool: 'nope.pool.mock', amount: '1' }, auth);
    expect(badPool.status).toBe(422);
    expect(badPool.body.errorCode).toBe('POOL_NOT_WHITELISTED');
  });

  it('unstaking after 7 days is free (corner: the 7-day window is measured from the last deposit, not from compounding)', async () => {
    const { url, staking } = await boot('all');
    const { accountId, auth } = await linkWallet('dave');
    await staking.fundWalletNear(accountId, '20');
    await post(url, '/v1/near/stake', { accountId, pool: POOL, amount: '20' }, auth);
    staking.advanceClockMs(8 * DAY);
    const u = StakingActionResponse.parse((await post(url, '/v1/near/unstake', { accountId, pool: POOL, amount: '5' }, auth)).body);
    expect(u.earlyExitFeeBp).toBe(0);
    expect(u.earlyExitFeeNear).toBe('0');
    expect(u.position.unbonding).toBe('5');
  });

});

describe('W28-04 wallet-first staking: spoofing, W28 off', () => {
  it('spoofing another wallet is refused: no session 401, someone else is 403, AI / bot callers are 403', async () => {
    const { url, staking } = await boot('all');
    const victim = await linkWallet('victim');
    await linkWallet('mallory');
    await staking.fundWalletNear(victim.accountId, '30');
    await post(url, '/v1/near/stake', { accountId: victim.accountId, pool: POOL, amount: '20' }, victim.auth);
    const body = { accountId: victim.accountId, pool: POOL, amount: '10' };

    const anonymous = await post<{ errorCode: string }>(url, '/v1/near/unstake', body);
    expect(anonymous.status).toBe(401);
    const stranger = await post<{ errorCode: string }>(url, '/v1/near/unstake', body, { authorization: 'Bearer dev:mallory' });
    expect(stranger.status).toBe(403);
    expect(stranger.body.errorCode).toBe('NEAR_NOT_OWNER');
    for (const path of ['/v1/near/stake', '/v1/near/withdraw']) {
      expect((await post(url, path, body, { authorization: 'Bearer dev:mallory' })).status).toBe(403);
    }
    expect((await post(url, '/v1/near/stake/compound', { accountId: victim.accountId, pool: POOL }, { authorization: 'Bearer dev:mallory' })).status).toBe(403);
    expect((await post(url, '/v1/near/stake/profits', { accountId: victim.accountId, amountUsdc: '1' }, { authorization: 'Bearer dev:mallory' })).status).toBe(403);
    expect((await post(url, '/v1/near/staking/patron/nominate', { accountId: victim.accountId, planetId: 'p' }, { authorization: 'Bearer dev:mallory' })).status).toBe(403);

    const bot = await post<{ errorCode: string }>(url, '/v1/near/stake', body, { 'x-api-key': 'ta_bot_abc123' });
    expect(bot.status).toBe(403);
    expect(bot.body.errorCode).toBe('AI_STAKING_FORBIDDEN');
    const ai = await post<{ errorCode: string }>(url, '/v1/near/stake/profits', { accountId: victim.accountId, amountUsdc: '1' }, { ...victim.auth, 'x-actor': 'ai' });
    expect(ai.status).toBe(403);
    expect(ai.body.errorCode).toBe('AI_STAKING_FORBIDDEN');

    // The victim's stake never moved.
    const status = StakingStatusResponse.parse(await get(url, `/v1/near/staking?accountId=${victim.accountId}`));
    expect(status.positions[0]?.staked).toBe('20');
  });


  it('with W28 off the W20 gates and 404s hold: DEED_NOT_FOUND for a deed-less wallet, new routes 404', async () => {
    const { url } = await boot('..27');
    const { accountId, auth } = await linkWallet('erin');
    const stake = await post<{ errorCode: string }>(url, '/v1/near/stake', { accountId, pool: POOL, amount: '10' }, auth);
    expect(stake.status).toBe(404);
    expect(stake.body.errorCode).toBe('DEED_NOT_FOUND');
    expect((await post(url, '/v1/near/stake/compound', { accountId, pool: POOL }, auth)).status).toBe(404);
    expect((await post(url, '/v1/near/stake/profits', { accountId, amountUsdc: '1' }, auth)).status).toBe(404);
    expect((await post(url, '/v1/near/staking/patron/nominate', { accountId, planetId: 'pl_w28_open' }, auth)).status).toBe(404);
    const status = await get<Record<string, unknown>>(url, '/v1/near/staking?colonyId=col_0');
    expect((status.perks as Record<string, unknown>).version).toBeUndefined();
  });
});

describe('W28-04 wallet-first staking: Lead Patron nomination', () => {
  it('patron nomination: only public planets, only for the wallet owner, and the seat follows ACTIVE stake', async () => {
    const { url, staking } = await boot('all');
    const whale = await linkWallet('whale');
    await db.prisma.planet.create({ data: { id: 'pl_w28_open', name: 'Open Planet' } });
    await db.prisma.planet.create({ data: { id: 'pl_w28_gone', name: 'Archived Planet', admission: 'ARCHIVED' } });
    await staking.fundWalletNear(whale.accountId, '600');

    const small = await post<{ isLeadPatron: boolean }>(url, '/v1/near/staking/patron/nominate', { accountId: whale.accountId, planetId: 'pl_w28_open' }, whale.auth);
    expect(small.status).toBe(200);
    expect(small.body.isLeadPatron).toBe(false);

    await post(url, '/v1/near/stake', { accountId: whale.accountId, pool: POOL, amount: '520' }, whale.auth);
    const lead = await post<{ isLeadPatron: boolean; leadPatron: { accountId: string; carrierName: string } }>(
      url,
      '/v1/near/staking/patron/nominate',
      { accountId: whale.accountId, planetId: 'pl_w28_open' },
      whale.auth,
    );
    expect(lead.body.isLeadPatron).toBe(true);
    expect(lead.body.leadPatron).toMatchObject({ accountId: whale.accountId, carrierName: 'ISS whale.near' });

    const archived = await post(url, '/v1/near/staking/patron/nominate', { accountId: whale.accountId, planetId: 'pl_w28_gone' }, whale.auth);
    expect(archived.status).toBe(404);
    const unknown = await post(url, '/v1/near/staking/patron/nominate', { accountId: whale.accountId, planetId: 'pl_missing' }, whale.auth);
    expect(unknown.status).toBe(404);

    // Unstaking 520 to 120 NEAR (below the Tier 4 minimum) clears the seat at once and the same call shows Tier 2.
    const down = StakingActionResponse.parse((await post(url, '/v1/near/unstake', { accountId: whale.accountId, pool: POOL, amount: '400' }, whale.auth)).body);
    expect(down.perks).toMatchObject({ tier: 2, leadPatronPlanetIds: [] });
  });
});

async function seedDeed(colonyId: string, accountId: string): Promise<void> {
  const metadata = { planet: 'pl_dune_01', colony: colonyId, stage: 3, terraformBp: 6000, status: 'active', settled: false, version: 1, imageUrl: `/v1/near/deed/deed:${colonyId}/image.png?v=1` };
  await db.prisma.deed.create({
    data: { colonyId, planetId: 'pl_dune_01', playerId: 'p_col_w28', accountId, tokenId: `deed:${colonyId}`, metadata, settled: false, status: 'active', chainState: 'ACTIVE' },
  });
}

describe('W28-04 colony-scoped requests while W28 is on (deed + claim gates kept, W28 effects added)', () => {
  it('colonyId-only stake / unstake record history rows, charge and report the early-exit fee, and answer with V2 perks', async () => {
    const { url, staking } = await boot('all');
    const colonyId = 'col_w28';
    const accountId = `${colonyId}.pilot.terraagent.mock`;
    await seedDeed(colonyId, accountId);
    await post(url, '/v1/near/claim-account', { colonyId, walletAccountId: 'pilot-w28.terraagent.mock', newPublicKey: 'ed25519:w28-key' });
    await staking.fundWalletNear(accountId, '30');

    const staked = StakingActionResponse.parse((await post(url, '/v1/near/stake', { colonyId, pool: POOL, amount: '20' })).body);
    expect(staked.position).toMatchObject({ colonyId, staked: '20' });
    expect(staked.perks).toMatchObject({ version: 2, tier: 1, platformFeeBp: 65 });

    const unstaked = StakingActionResponse.parse((await post(url, '/v1/near/unstake', { colonyId, pool: POOL, amount: '10' })).body);
    expect(unstaked.earlyExitFeeBp).toBe(25);
    expect(unstaked.earlyExitFeeNear).toBe('0.025');
    expect(unstaked.position.unbonding).toBe('9.975');

    const kinds = (await db.prisma.stakingTx.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } })).map((t) => t.kind);
    expect(kinds).toEqual(['stake', 'unstake', 'early_exit_fee']);

    // A request naming both keeps the colony view (deed + claim), not the bare-wallet one.
    const both = StakingStatusResponse.parse(await get(url, `/v1/near/staking?colonyId=${colonyId}&accountId=${accountId}`));
    expect(both).toMatchObject({ colonyId, deedSettled: false, accountClaimed: true });
  });

  it('colonyId-only compound keeps the deed gate (unknown colony is DEED_NOT_FOUND)', async () => {
    const { url } = await boot('all');
    const missing = await post<{ errorCode: string }>(url, '/v1/near/stake/compound', { colonyId: 'col_nope', pool: POOL });
    expect(missing.status).toBe(404);
    expect(missing.body.errorCode).toBe('DEED_NOT_FOUND');
  });
});
