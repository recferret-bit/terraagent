import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { StakingOverviewResponse, StakingPerformanceResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { nearToYocto } from '../../src/near/staking/yocto';

const POOL = 'astro-stakers.pool.mock';
const DAY = 86_400_000;
const apps: INestApplication[] = [];
let db: TestDatabase;
let urlOn: string;
let urlOff: string;

async function boot(waves: string) {
  const created = await createApp({
    source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', JWT_ACCESS_SECRET: 'test-jwt-secret-0123456789abcdef', DATABASE_URL: db.url, TA_WAVES: waves },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  return (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
}

const acct = (accountId: string, playerId: string, colonyId: string, owner: string) =>
  db.prisma.nearColonyAccount.create({
    data: { accountId, playerId, slot: `s-${accountId}`, colonyId, ownerAccountId: owner, publicKey: 'ed25519:t', encryptedSecret: 'x', kekVersion: 1 },
  });

let n = 0;
const usdc = (usd: number) => String(Math.round(usd * 1e6));
interface Fill { buyer: string; seller: string; stall: string; notionalUsd: number; platformFeeBp?: number; stallFeeUsd?: number; ageMs?: number }
async function fill(f: Fill) {
  const col = (a: string) => `col_${a.replace('.near', '')}`;
  await db.prisma.intentTrade.create({
    data: {
      tradeId: `t-${++n}`, planetId: 'planet-x', pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', makerOrderId: `m${n}`, takerOrderId: `k${n}`, makerSide: 'sell',
      buyerColonyId: col(f.buyer), sellerColonyId: col(f.seller), buyerAccountId: f.buyer, sellerAccountId: f.seller, stallColonyId: col(f.stall), stallAccountId: f.stall,
      platformAccountId: 'platform.mock', amount: '100', notional: usdc(f.notionalUsd), platformFee: usdc(f.notionalUsd * 0.005), stallFee: usdc(f.stallFeeUsd ?? 0),
      platformFeeBp: f.platformFeeBp ?? 65, stallFeeBp: 100, policyVersion: 'v1', policyHash: 'h', legs: [], batchHash: 'b', state: 'FINAL',
      createdAt: new Date(Date.now() - (f.ageMs ?? DAY)), settledAt: new Date(Date.now() - (f.ageMs ?? DAY)),
    },
  });
}

beforeAll(async () => {
  db = await createTestDatabase();
  urlOn = await boot('all');
  urlOff = await boot('..27');
  const now = Date.now();
  await acct('alice.near', 'p-alice', 'col_alice', 'alice.near');
  await acct('alice2.near', 'p-alice', 'col_alice2', 'alice.near');
  await acct('bob.near', 'p-bob', 'col_bob', 'bob.near');
  await acct('carol.near', 'p-carol', 'col_carol', 'carol.near');
  await db.prisma.stakingPosition.create({
    data: { colonyId: 'col_alice', poolId: POOL, accountId: 'alice.near', stakedSnapshot: nearToYocto(60), rewardsSnapshot: nearToYocto(0.25), stakedSinceAt: new Date(now - 3 * DAY), lastStakedAt: new Date(now - 3 * DAY) },
  });
  await db.prisma.stakingPosition.create({
    data: { colonyId: 'col_bob', poolId: 'meta-pool.mock', accountId: 'bob.near', asset: 'stNEAR', stakedSnapshot: nearToYocto(20), stakedSinceAt: new Date(now - DAY), lastStakedAt: new Date(now - DAY) },
  });
  await db.prisma.stakingTx.createMany({
    data: [
      { id: 'tx-1', accountId: 'alice.near', poolId: POOL, kind: 'stake', amountYocto: nearToYocto(60), txHash: 'mock-tx-1', createdAt: new Date(now - 3 * DAY) },
      { id: 'tx-2', accountId: 'alice.near', poolId: POOL, kind: 'compound', amountYocto: nearToYocto(0.5), txHash: 'mock-tx-2', createdAt: new Date(now - DAY) },
    ],
  });
  await db.prisma.stakingPatronPayout.create({ data: { id: 'pp-1', planetId: 'planet-x', accountId: 'alice.near', amountUsdcAtomic: usdc(1), createdAt: new Date(now - 2 * DAY) } });
  // Real counterparty: alice buys from bob at the 65 bp tier fee (standard 100 bp): saves 1000 * 35 bp = 3.5 USD.
  await fill({ buyer: 'alice.near', seller: 'bob.near', stall: 'carol.near', notionalUsd: 1000 });
  // Real royalty: alice owns the stall, bob buys from carol: 2 USD royalty.
  await fill({ buyer: 'bob.near', seller: 'carol.near', stall: 'alice.near', notionalUsd: 400, stallFeeUsd: 2, platformFeeBp: 100 });
  // Wash trades with huge notional: alice <-> her own second colony, and alice buying through her own stall.
  await fill({ buyer: 'alice.near', seller: 'alice2.near', stall: 'carol.near', notionalUsd: 50_000, stallFeeUsd: 500 });
  await fill({ buyer: 'alice.near', seller: 'bob.near', stall: 'alice2.near', notionalUsd: 50_000, stallFeeUsd: 500 });
  // Outside the 30d window but inside 90d.
  await fill({ buyer: 'alice.near', seller: 'bob.near', stall: 'carol.near', notionalUsd: 1000, ageMs: 45 * DAY });
}, 240_000);

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await db?.drop();
});

const perf = async (qs: string, url = urlOn) => fetch(`${url}/v1/near/staking/performance?${qs}`);

describe('W28-05 GET /v1/near/staking/performance', () => {
  it('excludes self-fills from savings, royalties and effective APY, and counts them', async () => {
    const res = await perf('accountId=alice.near&window=30d');
    expect(res.status).toBe(200);
    const b = StakingPerformanceResponse.parse(await res.json());
    expect(b.income.marketFeeSavingsUsd).toBeCloseTo(3.5, 6);
    expect(b.income.stallRoyaltiesUsd).toBeCloseTo(2, 6);
    expect(b.income.selfFillsExcluded).toBe(2);
    expect(b.income.patronRevenueUsd).toBeCloseTo(1, 6);
    // 0.5 compounded + 0.25 accrued
    expect(b.income.stakingYieldNear).toBeCloseTo(0.75, 6);
    expect(b.balances).toMatchObject({ activeStakedNear: '60', accruedYieldNear: '0.25', lst: [] });
    expect(b.price).toMatchObject({ source: 'est', nearUsd: 4 });
    expect(b.apy).toMatchObject({ source: 'sim', netApyBp: 720 });
    const extras = 3.5 + 2 + 1;
    const expected = Math.round(720 + (((extras * 365) / 30) / (60 * 4)) * 10_000);
    expect(b.effectiveApyBp).toBe(expected);
    expect(b.perks).toMatchObject({ tier: 2, version: 2 });
    expect(b.perks).not.toHaveProperty('totalStakedYocto');
    expect(b.aiBudget.colonySlotsMax).toBe(3);
    expect(b.timers.stakedSinceMs).not.toBeNull();
    expect(b.ecosystem.entries.map((e) => e.id)).toEqual(['metapool', 'linear', 'validator']);
    expect(b.txs.map((t) => t.kind)).toEqual(['compound', 'stake']);
    expect(b.txs.every((t) => t.explorerUrl === null)).toBe(true);
  });

  it('wider windows include older fills; series are valid for 30d, 90d and 1y', async () => {
    const w30 = StakingPerformanceResponse.parse(await (await perf('accountId=alice.near&window=30d')).json());
    const w90 = StakingPerformanceResponse.parse(await (await perf('accountId=alice.near&window=90d')).json());
    expect(w90.income.marketFeeSavingsUsd).toBeCloseTo(7, 6);
    expect(w90.income.marketFeeSavingsUsd).toBeGreaterThan(w30.income.marketFeeSavingsUsd);
    for (const w of ['30d', '90d', '1y'] as const) {
      const r = StakingPerformanceResponse.parse(await (await perf(`accountId=alice.near&window=${w}`)).json());
      const pts = r.series.points;
      expect(r.series.window).toBe(w);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      expect(pts.every((p, i) => i === 0 || (p.tMs >= pts[i - 1]!.tMs && p.valueNear >= pts[i - 1]!.valueNear))).toBe(true);
      expect(pts.some((p) => p.kind === 'projected')).toBe(true);
    }
  });

  it('defaults the window to 30d', async () => {
    const r = StakingPerformanceResponse.parse(await (await perf('accountId=alice.near')).json());
    expect(r.series.window).toBe('30d');
  });

  it('an unstaked / unknown wallet has zero effective APY and an empty but valid series', async () => {
    const r = StakingPerformanceResponse.parse(await (await perf('accountId=nobody.near&window=1y')).json());
    expect(r.effectiveApyBp).toBe(0);
    expect(r.income).toMatchObject({ marketFeeSavingsUsd: 0, stallRoyaltiesUsd: 0, selfFillsExcluded: 0, patronRevenueUsd: 0 });
    expect(r.series.points.length).toBeGreaterThanOrEqual(2);
    expect(r.txs).toEqual([]);
    expect(r.perks.tier).toBe(0);
  });

  it('shows LST holdings with their NEAR value', async () => {
    const r = StakingPerformanceResponse.parse(await (await perf('accountId=bob.near')).json());
    expect(r.balances.lst).toEqual([{ asset: 'stNEAR', amount: '20', nearValue: '20' }]);
    expect(r.balances.totalStakedUsd).toBeCloseTo(80, 6);
  });

  it('rejects a missing accountId and a bad window with 400', async () => {
    expect((await perf('window=30d')).status).toBe(400);
    expect((await perf('accountId=a')).status).toBe(400);
    expect((await perf('accountId=alice.near&window=7d')).status).toBe(400);
  });

  it('is 404 with W28 off', async () => {
    expect((await perf('accountId=alice.near', urlOff)).status).toBe(404);
    expect((await fetch(`${urlOff}/v1/near/staking/overview`)).status).toBe(404);
  });
});

describe('W28-05 GET /v1/near/staking/overview (public)', () => {
  it('works logged out with the default amount and a full tier table', async () => {
    const res = await fetch(`${urlOn}/v1/near/staking/overview`);
    expect(res.status).toBe(200);
    const b = StakingOverviewResponse.parse(await res.json());
    expect(b.network).toBe('mock');
    expect(b.tiers).toHaveLength(5);
    expect(b.projection.amountNear).toBe(50);
    expect(b.apy.source).toBe('sim');
    expect(b.price.source).toBe('est');
    expect(b.rules.standardTakerFeeBp).toBe(100);
    // 60 native (alice) + 20 stNEAR (bob)
    expect(b.ecosystem.totalNear).toBe('80');
    expect(b.ecosystem.entries.find((e) => e.id === 'metapool')).toMatchObject({ tvlNear: '20', sharePct: 25 });
    expect(b.ecosystem.entries.find((e) => e.id === 'validator')).toMatchObject({ tvlNear: '60', sharePct: 75 });
  });

  it('pre-fills the projection from ?amount, clamps, and falls back on bad input', async () => {
    const get = async (q: string) => StakingOverviewResponse.parse(await (await fetch(`${urlOn}/v1/near/staking/overview${q}`)).json());
    const a = await get('?amount=1000');
    expect(a.projection.yearlyNear).toBeCloseTo(72, 6);
    expect(a.projection.yearlyUsd).toBeCloseTo(288, 6);
    expect((await get('?amount=99999999999')).projection.amountNear).toBe(1_000_000);
    expect((await get('?amount=-5')).projection.amountNear).toBe(0);
    expect((await get('?amount=abc')).projection.amountNear).toBe(50);
  });
});
