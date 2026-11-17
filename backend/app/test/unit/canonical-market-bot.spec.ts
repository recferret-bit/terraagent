import { CANONICAL_PLANET_LIST } from '@terra/contracts';
import { compileMarketConfig, defaultBoardLimits, marketBoard } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import { actorStats } from '../../src/market/board/board-actors.js';
import {
  buildBootstrapCrosses,
  buildLadderSpecs,
  buildLiveCross,
  buildRebalanceCrosses,
  CANONICAL_BOT_PAIRS,
  CANONICAL_MARKET_BOTS,
  canonicalBotColonyId,
  resolveBotPlanetType,
} from '../../src/market/dev/canonical-market-bot.plan.js';
import { CanonicalMarketBotService } from '../../src/market/dev/canonical-market-bot.service.js';
import { isOrganicFill } from '../../src/market/settlement/organic.js';
import { TreasuryFeeService } from '../../src/market/settlement/treasury-fee.service.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider.js';
import { isSystemOrBotIntentSigner, TestnetIntentsAdapter } from '../../src/near/infrastructure/adapters/real/testnet-intents.adapter.js';
import { toNearException } from '../../src/near/infrastructure/rpc/near-error-map.js';

const policy = compileMarketConfig({ parameters: {} });

describe('canonical-market-bot ladder & cross math', () => {
  it('keeps 10 tradable pairs with non-crossing ladders and strictly inside-spread real crosses', () => {
    expect(CANONICAL_BOT_PAIRS).toHaveLength(10);
    for (const planet of CANONICAL_PLANET_LIST) {
      const perBot = new Map<number, number>();
      for (const [idx, spec] of CANONICAL_BOT_PAIRS.entries()) {
        const cfgPair = policy.pairs.find((p) => p.pair === spec.pair);
        expect(cfgPair, `${spec.pair} in policy`).toBeDefined();
        const levels = buildLadderSpecs(idx, planet.type, spec);
        const bestBid = levels.filter((l) => l.side === 'buy').sort((a, b) => Number(b.priceAmount - a.priceAmount))[0]!;
        const bestAsk = levels.filter((l) => l.side === 'sell').sort((a, b) => Number(a.priceAmount - b.priceAmount))[0]!;
        expect(bestBid.priceAmount).toBeLessThan(bestAsk.priceAmount);

        for (const cross of buildBootstrapCrosses(planet.type, spec, 6)) {
          expect(cross.buyerBot.slug).not.toBe(cross.sellerBot.slug);
          expect(cross.priceAmount).toBeGreaterThanOrEqual(BigInt(cfgPair!.minNotionalAtomic));
          // Cross unit price stays strictly inside the resting [bestBid, bestAsk] spread.
          expect(cross.priceAmount * BigInt(bestBid.amount)).toBeGreaterThan(bestBid.priceAmount * BigInt(cross.amount));
          expect(cross.priceAmount * BigInt(bestAsk.amount)).toBeLessThan(bestAsk.priceAmount * BigInt(cross.amount));
        }

        for (const lvl of levels) {
          expect(lvl.priceAmount).toBeGreaterThanOrEqual(BigInt(cfgPair!.minNotionalAtomic));
          perBot.set(lvl.botIndex, (perBot.get(lvl.botIndex) ?? 0) + 1);
        }
      }
      for (let b = 0; b < CANONICAL_MARKET_BOTS.length; b++) {
        expect(perBot.get(b)).toBe(12);
        expect(perBot.get(b)!).toBeLessThan(policy.openOrderLimit);
      }
    }
  });

  it('produces organic multi-party board stats from real bot crosses', () => {
    const nowMs = Date.UTC(2026, 10, 17, 10, 0, 0);
    const limits = defaultBoardLimits();
    const spec = CANONICAL_BOT_PAIRS[0]!;
    const crosses = buildBootstrapCrosses('desert', spec, 6);
    const trades = crosses.map((c, idx) => {
      const buyerCol = canonicalBotColonyId('pl_dev', c.buyerBot.slug);
      const sellerCol = canonicalBotColonyId('pl_dev', c.sellerBot.slug);
      expect(
        isOrganicFill(
          { actorKind: 'bot', colonyId: buyerCol, ownerId: c.buyerBot.playerId },
          { actorKind: 'bot', colonyId: sellerCol, ownerId: c.sellerBot.playerId },
          true,
        ),
      ).toBe(true);
      return {
        pair: spec.pair,
        amount: BigInt(c.amount),
        notional: c.priceAmount,
        atMs: nowMs - (6 - idx) * 60_000,
        organic: true,
        buyerId: buyerCol,
        sellerId: sellerCol,
        buyerKind: 'bot',
        sellerKind: 'bot',
      };
    });
    const rows = marketBoard(trades, nowMs, limits);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classification).toBe('organic');
    expect(rows[0]!.counterparties).toBe(5);
    expect(rows[0]!.concentrationBp).toBeLessThanOrEqual(2500);
    expect(actorStats(spec.pair, trades, nowMs, limits).botShareBp).toBe(10_000);
  });
});

describe('canonical-market-bot world discovery, real order crossing & gating', () => {
  it('discovers canonical, active DB, and loaded game worlds and places real maker+taker orders', async () => {
    const handle = vi.fn().mockResolvedValue({ created: true, depositChain: 0n, order: { orderId: 'mo_1', ref: 'r' } });
    const prisma = {
      planet: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'pl_dev', type: 'desert' },
          { id: 'pl_dev_ocean_3', type: 'ocean' },
        ]),
      },
      marketOrder: { count: vi.fn().mockResolvedValue(0) },
    };
    const gamePlanets = { loadedIds: () => ['pl_dev_4'], onPlanetLoaded: vi.fn() };
    const svc = new CanonicalMarketBotService(
      { handle } as never,
      { refresh: vi.fn(), current: () => policy } as never,
      { release: vi.fn().mockResolvedValue({ kind: 'released' }) } as never,
      prisma as never,
      { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' } as never,
      { has: (w: string) => w === 'W13' } as never,
      {} as never,
      gamePlanets as never,
    );

    const worlds = await svc.discoverActiveWorlds();
    expect(worlds.map((w) => w.id)).toContain('pl_dev');
    expect(worlds.map((w) => w.id)).toContain('pl_dev_ocean_3');
    expect(worlds.map((w) => w.id)).toContain('pl_dev_4');
    expect(resolveBotPlanetType('pl_dev_ocean_3')).toBe('ocean');

    const cross = buildLiveCross('ocean', CANONICAL_BOT_PAIRS[0]!, 0);
    await svc.executeRealBotCross('pl_dev_ocean_3', CANONICAL_BOT_PAIRS[0]!, cross, policy);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle.mock.calls[0]![0].data.side).toBe('sell');
    expect(handle.mock.calls[1]![0].data.side).toBe('buy');
    expect(handle.mock.calls[0]![1]).toEqual({ actorKind: 'bot', answerSim: false });
  });

  it('stays disabled in test/mainnet-prod and activates on testnet prod or TA_SEED_RIVAL_AI=1', () => {
    const makeSvc = (env: Record<string, string | undefined>) => {
      const svc = new CanonicalMarketBotService(
        { handle: vi.fn() } as never,
        { refresh: vi.fn(), current: () => policy } as never,
        { release: vi.fn().mockResolvedValue({ kind: 'released' }) } as never,
        {} as never,
        env as never,
        { has: (w: string) => w === 'W13' } as never,
      );
      return (svc as unknown as { enabled(): boolean }).enabled();
    };
    expect(makeSvc({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x' })).toBe(false);
    expect(makeSvc({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x' })).toBe(false);
    expect(makeSvc({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x', TA_SEED_RIVAL_AI: '1' })).toBe(true);
    expect(makeSvc({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', NEAR_MODE: 'testnet' })).toBe(true);
    expect(makeSvc({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', NEAR_MODE: 'mainnet' })).toBe(false);
    expect(
      makeSvc({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://x',
        NEAR_MODE: 'testnet',
        NEAR_ADAPTER_INTENTS: 'mainnet',
      }),
    ).toBe(false);
  });
});

describe('testnet gas guardrails for bot-only trades', () => {
  it('identifies bot/system signers and skips Testnet gas pings when no human account participates', async () => {
    expect(isSystemOrBotIntentSigner('bot-iron-pl_dev.terraagent.testnet')).toBe(true);
    expect(isSystemOrBotIntentSigner('protocol.terraagent.testnet')).toBe(true);
    expect(isSystemOrBotIntentSigner('pl-dev.dao.terraagent.testnet')).toBe(true);
    expect(isSystemOrBotIntentSigner('alice.pilots.terraagent.testnet')).toBe(false);

    const adapter = new TestnetIntentsAdapter(
      { NODE_ENV: 'production', DATABASE_URL: 'postgres://db', NEAR_MODE: 'testnet' } as never,
      {} as never,
    );
    const delegateExecute = vi.fn().mockResolvedValue({ network: 'mock', txHash: 'mock:abc123', raw: {} });
    const asTestnetReceipt = vi.fn().mockResolvedValue({ network: 'testnet', txHash: 'onchain_tx', raw: {} });
    (adapter as unknown as { delegate: { execute: typeof delegateExecute }; asTestnetReceipt: typeof asTestnetReceipt }).delegate = {
      execute: delegateExecute,
    };
    (adapter as unknown as { asTestnetReceipt: typeof asTestnetReceipt }).asTestnetReceipt = asTestnetReceipt;

    const botOnly = await adapter.execute({
      opId: 'trade:bot1',
      intents: [
        { diff: { accountId: 'bot-iron-pl_dev.terraagent.testnet', deltas: {} } },
        { diff: { accountId: 'protocol.terraagent.testnet', deltas: {} } },
      ] as never,
    });
    expect(botOnly.txHash).toBe('abc123');
    expect(asTestnetReceipt).not.toHaveBeenCalled();

    const withHuman = await adapter.execute({
      opId: 'trade:human1',
      intents: [
        { diff: { accountId: 'alice.pilots.terraagent.testnet', deltas: {} } },
        { diff: { accountId: 'protocol.terraagent.testnet', deltas: {} } },
      ] as never,
    });
    expect(withHuman.txHash).toBe('onchain_tx');
    expect(asTestnetReceipt).toHaveBeenCalledTimes(1);
  });

  it('skips DAO deposit RPC in production for bot-only fills while still depositing for human fills', async () => {
    const prodEnv = { NODE_ENV: 'production', NEAR_MODE: 'testnet', FLAGS: 'W22' } as never;
    const daos = {
      get: vi.fn().mockResolvedValue({ daoAccountId: 'pl_dev.dao.terraagent.testnet' }),
      deposit: vi.fn().mockResolvedValue({ network: 'testnet', txHash: 'dao_tx' }),
    };
    const svc = new TreasuryFeeService(
      new FlagsService(prodEnv),
      new MarketPolicyProvider(undefined, prodEnv),
      daos as never,
      {} as never,
      prodEnv,
    );

    await svc.depositSettled({
      tradeId: 'tr_bot',
      planetId: 'pl_dev',
      quote: 'USDC',
      treasuryFee: '1000',
      parties: [
        { colonyId: 'bot-iron.pl_dev' },
        { colonyId: 'bot-crimson.pl_dev' },
      ],
    });
    expect(daos.deposit).not.toHaveBeenCalled();

    await svc.depositSettled({
      tradeId: 'tr_human',
      planetId: 'pl_dev',
      quote: 'USDC',
      treasuryFee: '1000',
      parties: [
        { colonyId: 'co_human_1' },
        { colonyId: 'bot-crimson.pl_dev' },
      ],
    });
    expect(daos.deposit).toHaveBeenCalledTimes(1);
  });
});

describe('DAO missing fallback on testnet', () => {
  it('maps contract DAO_NOT_FOUND panic ahead of generic "does not exist" and falls back cleanly in TreasuryFeeService', async () => {
    const panicErr = new Error(
      'HostError(GuestPanic { panic_msg: "panicked at dao/src/lib.rs:472:14:\\nDAO_NOT_FOUND: dao does not exist" })',
    );
    const mapped = toNearException(panicErr);
    expect(mapped.errorCode).toBe('DAO_NOT_FOUND');

    const prodEnv = { NODE_ENV: 'production', NEAR_MODE: 'testnet', FLAGS: 'W22' } as never;
    const daos = { get: vi.fn().mockRejectedValue(mapped) };
    const svc = new TreasuryFeeService(
      new FlagsService(prodEnv),
      new MarketPolicyProvider(undefined, prodEnv),
      daos as never,
      {} as never,
      prodEnv,
    );
    const terms = await svc.termsFor('pl_01JKHAR0NDVNEST00000000000');
    expect(terms).toEqual({
      enabled: true,
      shareBp: 2000,
      accountId: 'treasury:pl_01JKHAR0NDVNEST00000000000',
    });
  });
});

describe('symmetric rotation and concentration rebalance', () => {
  it('keeps concentration <= 2500bp over 20 live rounds and rebalances a concentrated 4166bp pair', () => {
    const nowMs = Date.UTC(2026, 10, 17, 10, 0, 0);
    const limits = defaultBoardLimits();
    const spec = CANONICAL_BOT_PAIRS[0]!;
    const liveTrades = Array.from({ length: 20 }, (_, r) => {
      const c = buildLiveCross('desert', spec, r * 3);
      return {
        pair: spec.pair,
        amount: BigInt(c.amount),
        notional: c.priceAmount,
        atMs: nowMs - (20 - r) * 60_000,
        organic: true,
        buyerId: canonicalBotColonyId('pl_dev', c.buyerBot.slug),
        sellerId: canonicalBotColonyId('pl_dev', c.sellerBot.slug),
      };
    });
    const liveBoard = marketBoard(liveTrades, nowMs, limits);
    expect(liveBoard[0]!.classification).toBe('organic');
    expect(liveBoard[0]!.concentrationBp).toBeLessThanOrEqual(2500);

    const iron = canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', 'iron');
    const concentrated = [
      { buyerColonyId: iron, sellerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', 'crimson'), amount: 25n },
      { buyerColonyId: iron, sellerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', 'aether'), amount: 25n },
      { buyerColonyId: iron, sellerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', 'helios'), amount: 25n },
      { buyerColonyId: iron, sellerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', 'nexus'), amount: 25n },
      { buyerColonyId: iron, sellerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', 'crimson'), amount: 25n },
      { buyerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', 'aether'), sellerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', 'helios'), amount: 25n },
    ];
    const fixes = buildRebalanceCrosses('pl_01JKHAR0NDVNEST00000000000', 'desert', spec, concentrated);
    expect(fixes).toHaveLength(2);
    const fixedBoard = marketBoard(
      [...concentrated, ...fixes.map((c) => ({ buyerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', c.buyerBot.slug), sellerColonyId: canonicalBotColonyId('pl_01JKHAR0NDVNEST00000000000', c.sellerBot.slug), amount: BigInt(c.amount) }))].map(
        (t, idx) => ({ pair: spec.pair, amount: t.amount, notional: 30_000_000n, atMs: nowMs - (10 - idx) * 60_000, organic: true, buyerId: t.buyerColonyId, sellerId: t.sellerColonyId }),
      ),
      nowMs,
      limits,
    );
    expect(fixedBoard[0]!.classification).toBe('organic');
    expect(fixedBoard[0]!.concentrationBp).toBeLessThanOrEqual(3500);
  });
});
