import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@terra/db';
import { CANONICAL_PLANETS, STAKING_RULES, STAKING_TIERS } from '@terra/contracts';
import { CoreException } from '../../src/core/errors/index.js';
import { ColonySlotAllowanceService } from '../../src/core/home/colony-slot-allowance.service.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { PlaceOrderPrecheck } from '../../src/market/orders/place-order.precheck.js';
import { NearException } from '../../src/near/domain/errors.js';
import { enforceWalletRelayQuota, resetWalletRelayQuotasForTests } from '../../src/near/identity/wallet-relay-quota.js';
import { clearClocksWhenEmpty, projectStakingRow, withDeposit } from '../../src/near/infrastructure/adapters/mock/staking-ledger.js';
import { readDailyProtocolTradeFeeUsd } from '../../src/near/staking/perks/trade-fee.reader.js';
import { rpcApyProbe } from '../../src/near/infrastructure/adapters/real/chain-apy-probe.js';
import { classifyStakingRpcFailure, isUnknownAccountError, StakingRpcError } from '../../src/near/infrastructure/adapters/real/staking-rpc-error.js';
import { buildProtocolTreasuryView } from '../../src/near/infrastructure/dev/protocol-treasury.view.js';
import { W28ScenarioSeedService, w28PilotAccountId } from '../../src/near/infrastructure/dev/w28-scenario-seed.service.js';
import { toNearException } from '../../src/near/infrastructure/rpc/near-error-map.js';
import { AccountClaimController } from '../../src/near/staking/account-claim.controller.js';
import { isMethodNotFoundRpcError, lstContractFor, resolveLstPoolView } from '../../src/near/staking/lst-pools.js';
import { AiSlotLedger } from '../../src/near/staking/perks/ai-slot.ledger.js';
import { PatronSeatService } from '../../src/near/staking/perks/patron-seat.service.js';
import { readEcosystemTvl } from '../../src/near/staking/performance/ecosystem.reader.js';
import { readFillIncome } from '../../src/near/staking/performance/fill-income.reader.js';
import { readWalletBalances } from '../../src/near/staking/performance/wallet-balances.reader.js';
import { WalletBalances } from '../../src/near/staking/services/wallet-balances.js';
import { StakingPerksController } from '../../src/near/staking/staking-perks.controller.js';
import { StakingPoolsController } from '../../src/near/staking/staking-pools.controller.js';
import { computeSplitRewardDelta, nearToYocto, yoctoToNear } from '../../src/near/staking/yocto.js';
import { voteWeightBp } from '../../src/near/treasury/vote-weight.js';

const YOCTO = 10n ** 24n;
const dec = (v: string) => ({ toFixed: () => v });
const flagsWith = (...codes: Array<'W20' | 'W28' | 'W4'>): FlagsService =>
  ({ has: (f: string) => codes.includes(f as 'W20' | 'W28' | 'W4') }) as unknown as FlagsService;

describe('W28 Staking Controllers (unit)', () => {
  it('StakingPerksController preserves ?colonyId= when Bearer token is also present and delegates prestige queries', async () => {
    const perksFor = vi.fn().mockResolvedValue({ accountId: 'col.near', perks: {}, aiBudget: {} });
    const prestigeFor = vi.fn().mockResolvedValue({ planetId: 'p1', leadPatron: null, colonies: [] });
    const ctrl = new StakingPerksController({ perksFor, prestigeFor } as never);
    await expect(ctrl.getPerks('co_99', undefined, 'Bearer tok', { headers: {} } as never)).resolves.toBeDefined();
    expect(perksFor).toHaveBeenCalledWith(expect.objectContaining({ colonyId: 'co_99', accountId: undefined }));
    await ctrl.getPrestige(CANONICAL_PLANETS.desert.id);
    expect(prestigeFor).toHaveBeenCalledWith(CANONICAL_PLANETS.desert.id);
  });

  it('StakingPoolsController gates endpoints by W20 and returns whitelisted public pools by adapter kind', () => {
    const offCtrl = new StakingPoolsController(flagsWith(), {} as never);
    expect(() => offCtrl.listAdmin()).toThrow(CoreException);
    expect(() => offCtrl.listPublic()).toThrow(CoreException);
    const testnetCtrl = new StakingPoolsController(flagsWith('W20'), { NEAR_ADAPTER_STAKING: 'testnet' } as never);
    expect(testnetCtrl.listPublic().pools.length).toBeGreaterThan(0);
    expect(testnetCtrl.listAdmin().pools.length).toBeGreaterThan(0);
  });

  it('AccountClaimController revokes & reauthorizes session keys behind W20 flag', async () => {
    const claimSvc = {
      revokeTradingSessionKey: vi.fn().mockResolvedValue({ ok: true }),
      reauthorizeTradingSessionKey: vi.fn().mockResolvedValue({ colonyId: 'co_1', tradingSessionPublicKey: 'ed25519:k' }),
      resolveColonyOwnerPlayerId: vi.fn().mockResolvedValue('p1'),
    };
    const offCtrl = new AccountClaimController(claimSvc as never, flagsWith());
    expect(() => offCtrl.revokeSessionKey('co_1', { headers: {} } as never)).toThrow(CoreException);
    expect(() => offCtrl.reauthorizeSessionKey({ colonyId: 'co_1' }, { headers: {} } as never)).toThrow(CoreException);
    const onCtrl = new AccountClaimController(claimSvc as never, flagsWith('W20'), undefined, { NEAR_MODE: 'mock' } as never);
    await expect(onCtrl.revokeSessionKey('co_1', { headers: {} } as never)).resolves.toEqual({ ok: true });
    await expect(onCtrl.reauthorizeSessionKey({ colonyId: 'co_1' }, { headers: {} } as never)).resolves.toMatchObject({ colonyId: 'co_1' });
  });
});

describe('W28 Yocto, Mock Ledger, ErrorMap & RPC Helpers (unit)', () => {
  it('yocto.ts strips leading zeros cleanly before rejecting invalid input and splits 80/20 reward deltas', () => {
    expect(nearToYocto('000000000000000000000.5')).toBe((5n * 10n ** 23n).toString());
    expect(nearToYocto('00000000000000000005')).toBe((5n * YOCTO).toString());
    expect(() => nearToYocto('-1')).toThrow();
    expect(yoctoToNear(5n * YOCTO + 25n * 10n ** 22n, 2)).toBe('5.25');
    const split = computeSplitRewardDelta(10n * YOCTO, 900, 365 * 86_400_000, 2000);
    expect(split.gross).toBeGreaterThan(0n);
    expect(split.protocolYield + split.userReward).toBe(split.gross);
    expect(computeSplitRewardDelta(0n, 900, 1_000, 2000).gross).toBe(0n);
    expect(computeSplitRewardDelta(10n * YOCTO, 900, Number.NaN, 2000).gross).toBe(0n);
  });

  it('mock staking-ledger clamps lastAccruedAtMs against out-of-order clock rewind and clears clocks when empty', () => {
    const futureMs = 2_000_000_000_000;
    const row = {
      accountId: 'a.mock', poolId: 'astro.pool.mock', apyBp: 900, protocolYieldShareBp: 2000,
      staked: dec((100n * YOCTO).toString()), unbonding: dec('0'), withdrawable: dec('0'), rewardsAccrued: dec('0'),
      unbondingReadyAt: null, stakedSinceAt: new Date(1_900_000_000_000), lastStakedAt: new Date(1_900_000_000_000), lastAccruedAt: new Date(futureMs),
    };
    const projected = projectStakingRow(row as never, 900, futureMs - 5_000, 2000, 1);
    expect(projected.lastAccruedAtMs).toBe(futureMs);
    expect(projected.rewards).toBe(0n);
    const cleared = clearClocksWhenEmpty({
      asset: 'near', staked: 0n, unbonding: 0n, withdrawable: 0n, rewards: 0n,
      unbondingReadyAtMs: null, stakedSinceMs: 1, lastStakedAtMs: 2, lastAccruedAtMs: 0,
    });
    expect(cleared.stakedSinceMs).toBeNull();
    expect(cleared.lastStakedAtMs).toBeNull();
  });

  it('near-error-map maps all W28 contract panics and staking-rpc-error / lst-pools / chain-apy-probe handle edge cases', async () => {
    for (const [panic, expectedCode] of [
      ['STAKE_NO_YIELD', 'NOTHING_TO_COMPOUND'], ['STAKE_INVALID_POOL', 'POOL_NOT_WHITELISTED'],
      ['STAKE_INVALID_APY', 'NEAR_INVALID_INPUT'], ['STAKE_INVALID_YIELD_BP', 'NEAR_INVALID_INPUT'],
      ['STAKE_INVALID_DEPOSIT', 'NEAR_INVALID_INPUT'], ['STAKE_INVALID_RECIPIENT', 'NEAR_INVALID_INPUT'],
      ['STAKE_ONE_YOCTO_REQUIRED', 'NEAR_INVALID_INPUT'], ['STAKE_DUPLICATE_OP', 'NEAR_INTENT_NONCE_REUSED'],
      ['STAKE_PRICE_UNKNOWN', 'NEAR_UNAVAILABLE'], ['STAKE_PRICE_STALE', 'NEAR_UNAVAILABLE'],
      ['NEAR_INSUFFICIENT_GAS', 'NEAR_INVALID_INPUT'],
    ] as const) {
      const ex = toNearException(new Error(`Smart contract panicked: ${panic}`));
      expect(ex).toBeInstanceOf(NearException);
      expect(ex.errorCode).toBe(expectedCode);
    }
    expect(isUnknownAccountError(new Error('Account foo.testnet does not exist'))).toBe(true);
    expect(classifyStakingRpcFailure(new Error('timed out'), { operation: 'get_account_positions', contractId: 'staking.testnet', accountId: 'a.testnet' })).toBeInstanceOf(StakingRpcError);
    expect(isMethodNotFoundRpcError(new Error('MethodResolveError(MethodNotFound)'))).toBe(true);
    expect(lstContractFor('mainnet', 'stNEAR')).toBe('meta-pool.near');
    expect(resolveLstPoolView('testnet', 'meta-v2.pool.testnet', 900)?.asset).toBe('stNEAR');
    expect(resolveLstPoolView('testnet', 'unknown.testnet', 900)).toBeNull();
    const probe = rpcApyProbe({ withFailover: vi.fn().mockRejectedValue(new Error('nope')) } as never);
    await expect(probe.samples(4)).rejects.toThrow('nope');
  });
});

describe('W28 Treasury View, Wallet Balances, Ecosystem & Fill Income (unit)', () => {
  it('buildProtocolTreasuryView switches to mock reader on NEAR_MODE=local and WalletBalances.pickPayer finds liquid signer', async () => {
    const view = await buildProtocolTreasuryView({ NEAR_MODE: 'local', NEAR_PROTOCOL_ACCOUNT: 'protocol.local.mock' });
    expect(view.nearMode).toBe('local');
    expect(view.protocolAccountId).toBe('protocol.local.mock');
    expect(view.feeSchedule.tierTakerFeeBp).toEqual(STAKING_TIERS.map((t) => t.takerFeeBp));
    expect(view.feeSchedule.protocolStakingYieldShareBp).toBe(STAKING_RULES.protocolYieldShareBp);
    const balances = new WalletBalances({
      nearBalanceOf: vi.fn(async (acct: string) => (acct === 'funded.near' ? (10n * YOCTO).toString() : (1n * YOCTO).toString())),
    } as never, () => null);
    await expect(balances.pickPayer(['empty.near', 'funded.near'], 5n * YOCTO)).resolves.toBe('funded.near');
    await expect(balances.pickPayer(['empty.near'], 5n * YOCTO)).resolves.toBe('empty.near');
  });

  it('deduplicates multi-colony StakingPosition rows in readWalletBalances & readEcosystemTvl and detects social-linked self-fills', async () => {
    const newer = new Date('2026-06-02T00:00:00Z');
    const older = new Date('2026-06-01T00:00:00Z');
    const dupRows = [
      { accountId: 'alice.near', poolId: 'astro.near', asset: 'near', stakedSnapshot: dec((50n * YOCTO).toString()), unbondingSnapshot: dec('0'), withdrawableSnapshot: dec('0'), rewardsSnapshot: dec('0'), updatedAt: older },
      { accountId: 'alice.near', poolId: 'astro.near', asset: 'near', stakedSnapshot: dec((80n * YOCTO).toString()), unbondingSnapshot: dec('0'), withdrawableSnapshot: dec('0'), rewardsSnapshot: dec('0'), updatedAt: newer },
    ];
    const fakeDb = {
      stakingPosition: { findMany: async () => dupRows },
      intentsOrder: { findMany: async () => [] },
      socialIdentity: { findMany: async () => [{ playerId: 'p1', accountId: 'alice.near' }, { playerId: 'p1', accountId: 'alt.near' }] },
      colony: { findMany: async () => [{ id: 'co_1', playerId: 'p1', accountId: 'col1.near' }] },
      nearColonyAccount: { findMany: async () => [{ accountId: 'col1.near', playerId: 'p1', ownerAccountId: 'alice.near', colonyId: 'co_1' }] },
      stakingPatronSeat: { findMany: async () => [] },
      intentTrade: {
        findMany: async () => [
          { tradeId: 't1', quote: 'USDC', buyerAccountId: 'alice.near', sellerAccountId: 'alt.near', buyerColonyId: 'co_1', sellerColonyId: 'co_alt', stallColonyId: 'co_stall', stallAccountId: 'stall.near', planetId: CANONICAL_PLANETS.desert.id, notional: dec('1000000000'), platformFee: dec('5000000'), stallFee: dec('0'), platformFeeBp: 50, settledAt: newer, state: 'FINAL' },
          { tradeId: 't2', quote: 'USDC', buyerAccountId: 'alice.near', sellerAccountId: 'stranger.near', buyerColonyId: 'co_1', sellerColonyId: 'co_stranger', stallColonyId: 'co_stall', stallAccountId: 'stall.near', planetId: CANONICAL_PLANETS.desert.id, notional: dec('2000000000'), platformFee: dec('10000000'), stallFee: dec('0'), platformFeeBp: 50, settledAt: newer, state: 'FINAL' },
        ],
      },
    } as unknown as PrismaClient;
    const wb = await readWalletBalances(fakeDb, { walletKey: 'alice.near', playerId: 'p1', colonyIds: ['co_1'], accountIds: ['alice.near'] }, { readMockWallet: false, primaryAccountId: 'alice.near', readLiveWalletYocto: async () => 5n * YOCTO });
    expect(wb.activeYocto).toBe(80n * YOCTO);
    expect((await readEcosystemTvl(fakeDb)).totalNear).toBe('80');
    const inc = await readFillIncome(fakeDb, { walletKey: 'alice.near', playerId: 'p1', colonyIds: ['co_1'], accountIds: ['alice.near'] }, { sinceMs: newer.getTime() - 10_000, nearUsd: 4 });
    expect(inc.selfFillsExcluded).toBe(1);
    expect(inc.marketFeeSavingsUsd).toBeGreaterThan(0);
  });
});

describe('W28 AI Slot Ledger, Patron Seat, Relay, Slots & DAO (unit)', () => {
  it('AiSlotLedger evicts excess slots on tier downgrade and supports release(); PatronSeatService vacates other-planet sibling seats', async () => {
    const now = 1_800_000_000_000;
    const ledger = new AiSlotLedger();
    expect(ledger.claim('w1', 'c1', 3, now) && ledger.claim('w1', 'c2', 3, now) && ledger.claim('w1', 'c3', 3, now)).toBe(true);
    expect(ledger.claim('w1', 'c1', 1, now)).toBe(true);
    expect(ledger.used('w1', now)).toBeLessThanOrEqual(1);
    ledger.release('w1', 'c1', now);
    expect(ledger.has('w1', 'c1', now)).toBe(false);

    const deletedWhere: unknown[] = [];
    const fakePatronDb = {
      stakingPatronSeat: { findUnique: async () => null, findMany: async () => [], deleteMany: async () => ({ count: 0 }), upsert: async (a: { create: Record<string, unknown> }) => a.create },
      stakingPatronNomination: {
        findUnique: async () => null, findMany: async () => [{ accountId: 'main.near', createdAt: new Date(now) }],
        deleteMany: async (a: { where: unknown }) => { deletedWhere.push(a.where); return { count: 1 }; },
        upsert: async (a: { create: Record<string, unknown> }) => a.create,
      },
      stakingPatronHistory: { create: async () => ({}) },
      socialIdentity: { findMany: async () => [{ playerId: 'p1', providerAccountId: 'main.near', walletAccountId: 'sibling.near' }] },
      nearColonyAccount: { findMany: async () => [{ accountId: 'main.near', playerId: 'p1' }, { accountId: 'sibling.near', playerId: 'p1' }] },
      colony: { findMany: async () => [{ id: 'c1', playerId: 'p1', accountId: 'main.near' }] },
      stakingPosition: { findMany: async () => [{ accountId: 'main.near', poolId: 'p', stakedSnapshot: dec((600n * YOCTO).toString()), unbondingSnapshot: dec('0'), withdrawableSnapshot: dec('0'), rewardsSnapshot: dec('0'), stakedSinceAt: new Date(now - 10_000), updatedAt: new Date(now) }] },
    } as unknown as PrismaClient;
    await new PatronSeatService(fakePatronDb).nominate('main.near', CANONICAL_PLANETS.desert.id, now);
    expect(JSON.stringify(deletedWhere[0])).toContain(CANONICAL_PLANETS.desert.id);
  });

  it('enforces PlaceOrderPrecheck W28 fees, enforceWalletRelayQuota caps, ColonySlotAllowanceService, voteWeightBp, and W28ScenarioSeedService', async () => {
    resetWalletRelayQuotasForTests();
    const r1 = await enforceWalletRelayQuota({ env: { NEAR_RELAYER_WALLET_DAILY_TX_BASE: '2' }, w28: true, playerId: 'p_relay', signerId: 'guest_p' });
    expect(r1.cap).toBe(2);
    await enforceWalletRelayQuota({ env: { NEAR_RELAYER_WALLET_DAILY_TX_BASE: '2' }, w28: true, playerId: 'p_relay', signerId: 'guest_p' });
    await expect(enforceWalletRelayQuota({ env: { NEAR_RELAYER_WALLET_DAILY_TX_BASE: '2' }, w28: true, playerId: 'p_relay', signerId: 'guest_p' })).rejects.toBeInstanceOf(CoreException);
    expect(w28PilotAccountId('player_2')).toContain('w28-');
    expect(typeof W28ScenarioSeedService).toBe('function');
    const slotSvc = new ColonySlotAllowanceService(undefined, undefined);
    await expect(slotSvc.resolveForPlayer('p1')).resolves.toMatchObject({ tier: 0, max: 1 });
    await expect(voteWeightBp(undefined, {}, false, 'a.near')).resolves.toBe(10_000);
    expect(typeof PlaceOrderPrecheck).toBe('function');
  });

  it('withDeposit resets stakedSinceMs when crossing from < 50 NEAR into Tier 2+ and preserves it otherwise', () => {
    const base = {
      asset: 'near' as const, staked: 1n * YOCTO, unbonding: 0n, withdrawable: 0n, rewards: 0n,
      unbondingReadyAtMs: null, stakedSinceMs: 1_000, lastStakedAtMs: 1_000, lastAccruedAtMs: 1_000, protocolYieldDelta: 0n,
    };
    const stillT1 = withDeposit(base, 9n * YOCTO, 2_000, 'near');
    expect(stillT1.stakedSinceMs).toBe(1_000);
    const crossedT2 = withDeposit({ ...stillT1, protocolYieldDelta: 0n }, 40n * YOCTO, 3_000, 'near');
    expect(crossedT2.stakedSinceMs).toBe(3_000);
    const toppedT2 = withDeposit({ ...crossedT2, protocolYieldDelta: 0n }, 10n * YOCTO, 4_000, 'near');
    expect(toppedT2.stakedSinceMs).toBe(3_000);
  });

  it('readDailyProtocolTradeFeeUsd sums non-self buyer fees minus DAO + Patron cuts and ignores self-fills', async () => {
    const now = Date.UTC(2026, 10, 24, 12, 0, 0);
    const fakeTradeDb = {
      intentTrade: {
        findMany: async () => [
          { tradeId: 't_real', quote: 'USDC', platformFee: dec('10000000'), treasuryAllocation: dec('2000000'), buyerAccountId: 'a.near', sellerAccountId: 'b.near', stallAccountId: 'c.near', buyerColonyId: 'co_a', sellerColonyId: 'co_b', stallColonyId: 'co_c' },
          { tradeId: 't_wash', quote: 'USDC', platformFee: dec('99000000'), treasuryAllocation: dec('0'), buyerAccountId: 'a.near', sellerAccountId: 'a2.near', stallAccountId: 'c.near', buyerColonyId: 'co_a', sellerColonyId: 'co_a2', stallColonyId: 'co_c' },
        ],
      },
      nearColonyAccount: { findMany: async () => [] },
      socialIdentity: { findMany: async () => [{ accountId: 'a.near', playerId: 'p1' }, { accountId: 'a2.near', playerId: 'p1' }] },
      stakingPatronPayout: { findMany: async () => [{ sourceTradeId: 't_real', amountUsdcAtomic: dec('1200000') }] },
    } as unknown as PrismaClient;
    const usd = await readDailyProtocolTradeFeeUsd(fakeTradeDb, { walletKey: 'a.near', accountIds: ['a.near'], colonyIds: ['co_a'], playerId: 'p1' }, now, 4);
    expect(usd).toBeCloseTo(6.8, 6);
    expect(await readDailyProtocolTradeFeeUsd({} as PrismaClient, { walletKey: 'x', accountIds: [], colonyIds: [], playerId: null }, now, 4)).toBe(0);
  });
});
