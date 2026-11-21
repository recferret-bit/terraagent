import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { MARKET_TOKENS, StakingActionResponse, StakingStatusResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { creditVerifier } from '../../src/near/infrastructure/adapters/mock/intents-ledger';
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

describe('W28 wallet-first <-> unclaimed custodial colony unification', () => {
  it('links an unclaimed custodial colony sub-account to the pilot near-wallet stake across /v1/trade/policy, /v1/near/staking/performance & /v1/near/stake/profits', async () => {
    const pid = devPlayerId('unified-alice');
    const walletId = 'unified-alice.near';
    const auth = { authorization: 'Bearer dev:unified-alice' };
    await db.prisma.planet.create({ data: { id: 'pl_uni', name: 'pl_uni' } });
    await db.prisma.player.upsert({ where: { id: pid }, create: { id: pid, handle: 'unified-alice' }, update: {} });
    await db.prisma.socialIdentity.create({
      data: { id: 'si_uni_near', playerId: pid, provider: 'near-wallet', subject: walletId, accountId: walletId },
    });
    await db.prisma.colony.create({
      data: { id: 'co_uni_1', planetId: 'pl_uni', playerId: pid, colonyIndex: 0, name: 'Alpha' },
    });
    const custodialAcct = 'co_uni_1.pilots.terraagent.mock';
    await db.prisma.nearColonyAccount.create({
      data: {
        accountId: custodialAcct,
        playerId: pid,
        slot: 'c0',
        colonyId: 'co_uni_1',
        ownerAccountId: custodialAcct,
        claimedByAccountId: null,
        publicKey: 'ed25519:uni',
        encryptedSecret: 'enc',
        kekVersion: 1,
      },
    });

    // Stake 200 NEAR on walletId -> warm up 2 days -> Tier 3 (35 bp).
    await staking.fundWalletNear(walletId, '250');
    await post('/v1/near/stake', { accountId: walletId, pool: POOL, amount: '200' }, auth);
    staking.advanceClockMs(2 * DAY);

    // 1. Querying perks by custodial colony sub-account MUST resolve Alice's 200 NEAR Tier 3 (35 bp, NOT 100 bp!).
    const colonyPerks = await perksOf(`colonyId=co_uni_1&accountId=${custodialAcct}`);
    expect(colonyPerks).toMatchObject({ tier: 3, platformFeeBp: 35 });

    // 2. /v1/trade/policy for Alice's session on pl_uni MUST also return 35 bp!
    const polRes = await fetch(`${url}/v1/trade/policy?planetId=pl_uni`, { headers: auth });
    const polBody = (await polRes.json()) as { policy: { platformFeeBp: number; stakerDiscountActive?: boolean } };
    expect(polBody.policy).toMatchObject({ platformFeeBp: 35, stakerDiscountActive: true });

    // 3. Record a non-self FINAL fill on custodialAcct and verify /v1/near/staking/performance?accountId=unified-alice.near sees the fee savings!
    await db.prisma.intentTrade.create({
      data: {
        tradeId: 'tr_uni_1',
        planetId: 'pl_uni',
        pair: 'bio.water/USDC',
        base: 'bio.water',
        quote: 'USDC',
        amount: '100',
        notional: '100000000', // $100.00 USDC
        platformFee: '350000', // 35 bp
        platformFeeBp: 35,
        stallFee: '0',
        stallFeeBp: 0,
        makerOrderId: 'ord_m',
        takerOrderId: 'ord_t',
        makerSide: 'sell',
        buyerColonyId: 'co_uni_1',
        sellerColonyId: 'co_other',
        stallColonyId: 'co_other',
        buyerAccountId: custodialAcct,
        sellerAccountId: 'seller.pilots.terraagent.mock',
        stallAccountId: 'seller.pilots.terraagent.mock',
        platformAccountId: PROTOCOL,
        policyVersion: 'v1',
        policyHash: 'ph_1',
        legs: [],
        batchHash: 'bh_1',
        state: 'FINAL',
        settledAt: new Date(),
      },
    });
    const perfRes = await fetch(`${url}/v1/near/staking/performance?accountId=${walletId}`);
    const perf = (await perfRes.json()) as { income: { marketFeeSavingsUsd: number } };
    expect(perf.income.marketFeeSavingsUsd).toBeCloseTo(0.65, 2); // saved 65 bp on $100 = $0.65

    // 4. Credit 20 USDC trade profit onto custodialAcct and stake profits from BOTH walletId AND omitted accountId!
    await creditVerifier(db.prisma, custodialAcct, MARKET_TOKENS.USDC.verifierId, 20_000_000n);
    const sp1 = await post<{ txHash: string | null }>('/v1/near/stake/profits', { accountId: walletId, amountUsdc: '10.00' }, auth);
    expect(sp1.status).toBe(200);
    expect(sp1.body.txHash).toBeTruthy();

    const sp2 = await post<{ txHash: string | null }>('/v1/near/stake/profits', { amountUsdc: '5.00' }, auth);
    expect(sp2.status).toBe(200);
    expect(sp2.body.txHash).toBeTruthy();
  });
});

describe('W28 multi-asset Native + stNEAR split & explorer wallet rows', () => {
  it('keeps native NEAR separate from stNEAR on /v1/near/staking/performance and /v1/dev/chain/staking', async () => {
    const walletId = 'unified-alice.near';
    const perfAfterLst = (await (await fetch(`${url}/v1/near/staking/performance?accountId=${walletId}`)).json()) as {
      balances: { activeStakedNear: string; lst: Array<{ asset: string; amount: string }> };
      perks: { totalStakedNear: string };
    };
    expect(Number(perfAfterLst.balances.activeStakedNear)).toBeCloseTo(200, 4);
    const stNearEntry = perfAfterLst.balances.lst.find((l) => l.asset === 'stNEAR');
    expect(Number(stNearEntry?.amount ?? '0')).toBeGreaterThan(3);
    expect(Number(perfAfterLst.perks.totalStakedNear)).toBeCloseTo(
      Number(perfAfterLst.balances.activeStakedNear) + Number(stNearEntry?.amount ?? '0'),
      4,
    );

    const expRows = (await (await fetch(`${url}/v1/dev/chain/staking?account=${walletId}`)).json()) as Array<{
      kind: string;
      colonyId: string;
      tier?: number;
    }>;
    expect(expRows.find((r) => r.kind === 'position')).toMatchObject({ colonyId: 'wallet', tier: 3 });
  });
});

describe('W28 concurrent PatronSeatService multi-whale cross-planet safety', () => {
  it('survives concurrent cross-planet nominations and unstakes across 4 whales with zero deadlocks and exact final winners', async () => {
    for (const id of ['pl_race_a', 'pl_race_b']) await db.prisma.planet.create({ data: { id, name: id } });
    const whales = await Promise.all(
      [
        ['race-w1', '500'],
        ['race-w2', '550'],
        ['race-w3', '600'],
        ['race-w4', '700'],
      ].map(async ([name, amt]) => {
        const w = await linkWallet(name!);
        await staking.fundWalletNear(w.accountId, '800');
        await post('/v1/near/stake', { accountId: w.accountId, pool: POOL, amount: amt }, w.auth);
        return w;
      }),
    );
    const [w1, w2, w3, w4] = whales as [typeof whales[0], typeof whales[0], typeof whales[0], typeof whales[0]];

    // Seed initial nominations on opposite planets so cross-switching tests alphabetical lock ordering!
    await post('/v1/near/staking/patron/nominate', { accountId: w1.accountId, planetId: 'pl_race_a' }, w1.auth);
    await post('/v1/near/staking/patron/nominate', { accountId: w2.accountId, planetId: 'pl_race_b' }, w2.auth);
    await post('/v1/near/staking/patron/nominate', { accountId: w3.accountId, planetId: 'pl_race_a' }, w3.auth);
    await post('/v1/near/staking/patron/nominate', { accountId: w4.accountId, planetId: 'pl_race_b' }, w4.auth);

    // Hammer concurrent cross-planet switches + w4 unstaking below 500!
    const responses = await Promise.all([
      post('/v1/near/staking/patron/nominate', { accountId: w1.accountId, planetId: 'pl_race_b' }, w1.auth),
      post('/v1/near/staking/patron/nominate', { accountId: w2.accountId, planetId: 'pl_race_a' }, w2.auth),
      post('/v1/near/staking/patron/nominate', { accountId: w3.accountId, planetId: 'pl_race_b' }, w3.auth),
      post('/v1/near/unstake', { accountId: w4.accountId, pool: POOL, amount: '250' }, w4.auth), // w4 drops 700 -> 450 (< 500)
    ]);
    for (const r of responses) expect(r.status).toBe(200);

    // Final active stakes: pl_race_a has w2 (550); pl_race_b has w1 (500), w3 (600), w4 (450 < 500) -> w3 wins pl_race_b!
    const seatA = await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: 'pl_race_a' } });
    const seatB = await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: 'pl_race_b' } });
    expect(seatA?.accountId).toBe(w2.accountId);
    expect(seatB?.accountId).toBe(w3.accountId);
  });

  it('serializes concurrent POST /v1/trade/keys requests under W28 so Tier 0 never exceeds 1 active bot key', async () => {
    const cadet = await linkWallet('bot-race-cadet');
    const pid = devPlayerId('bot-race-cadet');
    await db.prisma.planet.create({ data: { id: 'pl_bot_race', name: 'pl_bot_race' } });
    await db.prisma.colony.create({
      data: { id: 'co_bot_race', planetId: 'pl_bot_race', playerId: pid, colonyIndex: 0, name: 'BotCol' },
    });
    await db.prisma.nearColonyAccount.create({
      data: {
        accountId: 'co_bot_race.pilots.terraagent.mock',
        playerId: pid,
        slot: 'c0',
        colonyId: 'co_bot_race',
        ownerAccountId: 'co_bot_race.pilots.terraagent.mock',
        publicKey: 'ed25519:botrace',
        encryptedSecret: 'enc',
        kekVersion: 1,
      },
    });

    const parallel = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        post('/v1/trade/keys', { planetId: 'pl_bot_race', label: `bot-${i}`, scopes: ['read', 'trade'] }, cadet.auth),
      ),
    );
    const okCount = parallel.filter((r) => r.status === 200 || r.status === 201).length;
    const rejectedCount = parallel.filter((r) => r.status === 409 || r.status === 400 || r.status === 429).length;
    expect(okCount).toBe(1);
    expect(rejectedCount).toBe(3);
  });
});
