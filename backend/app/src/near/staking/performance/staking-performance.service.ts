import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import {
  PerformanceWindow,
  StakingOverviewResponse,
  StakingPerformanceResponse,
  STAKING_RULES,
  STAKING_TIERS,
  type ApyView,
  type StakingTxRow,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { StakingPort } from '../../application/ports/staking.port.js';
import { nearAdapterFor } from '../../infrastructure/adapter-selection.js';
import { resolveNearNetworkConfig } from '../../infrastructure/network/near-network.config.js';
import { resolveStakingTimings } from '../local-staking-timings.js';
import { resolveWalletPerks } from '../perks/perks.resolver.js';
import { releasePerksPriceProvider, setPerksDeps, stakingNowMs } from '../perks/perks-deps.js';
import { resolveWallet } from '../perks/stake-clock.reader.js';
import { portHooks } from '../services/port-hooks.js';
import { StakingPositionSyncService } from '../staking-position-sync.service.js';
import { buildAiBudgetView } from '../perks/tier-engine.js';
import { buildApyView, VALIDATOR_APY_READER, type ValidatorApyReader } from './apy.js';
import { readEcosystemTvl } from './ecosystem.reader.js';
import { readFillIncome, EMPTY_FILL_INCOME } from './fill-income.reader.js';
import { effectiveApyBp, parsePreviewAmount, projectIncome, YEAR_MS } from './income-math.js';
import { NearUsdPriceService } from './near-usd-price.service.js';
import { readPatronIncome } from './patron-income.reader.js';
import { buildSeries, WINDOW_MS, type IncomeEvent } from './series.builder.js';
import { lstNearValue, nearText, readStakingTxs, readWalletBalances, yoctoToNearNumber, EMPTY_BALANCES, type TxRecord } from './wallet-balances.reader.js';

type Network = 'mock' | 'testnet' | 'mainnet';
const TX_LIST_LIMIT = 25;

/**
 * W28-05 read side of the wealth dashboard: the public `overview` preview and the per-wallet `performance` view.
 * Thin orchestrator: price, APY, readers (fills, patron, balances, ecosystem) and the series builder are the parts.
 */
@Injectable()
export class StakingPerformanceService implements OnModuleDestroy {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(NearUsdPriceService) private readonly price: NearUsdPriceService,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(VALIDATOR_APY_READER) private readonly apyReader?: ValidatorApyReader,
    @Optional() @Inject(StakingPort) private readonly staking?: StakingPort,
    @Optional() @Inject(StakingPositionSyncService) private readonly positionSync?: StakingPositionSyncService,
  ) {
    // The perks AI budget scales with the live NEAR/USD this service caches.
    setPerksDeps({ priceProvider: this.price });
  }

  onModuleDestroy(): void {
    releasePerksPriceProvider(this.price);
  }

  assertWaveEnabled(): void {
    if (!this.flags.has('W28')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }

  async overview(rawAmount: unknown): Promise<StakingOverviewResponse> {
    this.assertWaveEnabled();
    const network = this.network();
    const timings = resolveStakingTimings(this.envBag());
    const [price, apy, ecosystem] = await Promise.all([this.price.view(), this.apy(network), readEcosystemTvl(this.prisma)]);
    return StakingOverviewResponse.parse({
      asOfMs: stakingNowMs(),
      network,
      price,
      apy,
      tiers: STAKING_TIERS,
      rules: {
        feeWarmupMs: timings.feeWarmupMs,
        earlyExitWindowMs: timings.earlyExitWindowMs,
        earlyExitFeeBp: STAKING_RULES.earlyExitFeeBp,
        freeTrialTurns: STAKING_RULES.freeTrialTurns,
        standardTakerFeeBp: STAKING_TIERS[0]!.takerFeeBp,
        unbondingMs: timings.unbondingMs,
        rewardRateMultiplier: timings.rewardMultiplier,
      },
      projection: projectIncome(parsePreviewAmount(rawAmount), apy.netApyBp, price.nearUsd),
      ecosystem,
    });
  }

  /**
   * Readable without a session, like a block explorer: it only aggregates on-chain stake rows and public market fills
   * of the wallet, and returns no player id, settings or keys.
   */
  async performance(rawAccountId: unknown, rawWindow: unknown, nowMs = stakingNowMs()): Promise<StakingPerformanceResponse> {
    this.assertWaveEnabled();
    const { accountId, window, windowMs, sinceMs } = this.parsePerformanceQuery(rawAccountId, rawWindow, nowMs);
    const network = this.network();
    const db = this.prisma;
    if (network !== 'mock' && this.positionSync) {
      const wallet = db ? await resolveWallet(db, { accountId }).catch(() => null) : null;
      const targets = wallet && wallet.accountIds.length > 0 ? wallet.accountIds : [accountId];
      await Promise.all(targets.map((acct) => this.positionSync!.syncAccountPositions(acct, undefined, acct === accountId).catch(() => [])));
    }

    const [priceView, apy, ecosystem] = await Promise.all([this.price.view(), this.apy(network), readEcosystemTvl(db)]);
    const nearUsd = priceView.nearUsd;
    const r = await resolveWalletPerks(db, { accountId, env: this.envBag(), w28: true, full: true, nowMs, grossApyBp: apy.grossApyBp });
    const [balances, txs, fills, patron] = await this.loadWalletLedger(db, r.wallet, accountId, network, nowMs, sinceMs, nearUsd, apy);

    const lst = balances.lst.map((l) => ({ asset: l.asset, amount: nearText(l.amountYocto), nearValue: nearText(lstNearValue(l.asset, l.amountYocto)) }));
    const stakedNear = yoctoToNearNumber(balances.activeYocto) + balances.lst.reduce((s, l) => s + yoctoToNearNumber(lstNearValue(l.asset, l.amountYocto)), 0);
    const totalStakedUsd = stakedNear * nearUsd;
    const yieldEvents: IncomeEvent[] = txs.filter((t) => t.kind === 'compound').map((t) => ({ tMs: t.atMs, valueNear: yoctoToNearNumber(t.amountYocto) }));
    const accruedNear = yoctoToNearNumber(balances.accruedYocto);
    const stakingYieldNear = yieldEvents.reduce((s, e) => s + e.valueNear, 0) + accruedNear;
    const extrasUsd = fills.marketFeeSavingsUsd + fills.stallRoyaltiesUsd + patron.usd;
    const toNear = (usd: number): number => (nearUsd > 0 ? usd / nearUsd : 0);
    const events: IncomeEvent[] = [
      ...yieldEvents,
      ...(accruedNear > 0 ? [{ tMs: nowMs, valueNear: accruedNear }] : []),
      ...[...fills.events, ...patron.events].map((e) => ({ tMs: e.tMs, valueNear: toNear(e.usd) })),
    ];

    const { totalStakedYocto: _a, stakedYocto: _b, ...perks } = r.perks;
    return StakingPerformanceResponse.parse({
      accountId,
      asOfMs: nowMs,
      price: priceView,
      apy,
      balances: {
        walletNear: nearText(balances.walletYocto),
        activeStakedNear: nearText(balances.activeYocto),
        unbondingNear: nearText(balances.unbondingYocto),
        withdrawableNear: nearText(balances.withdrawableYocto),
        accruedYieldNear: nearText(balances.accruedYocto),
        lst,
        totalStakedUsd,
      },
      timers: {
        stakedSinceMs: perks.stakedSinceMs,
        feeWarmupReadyAtMs: perks.feeWarmupReadyAtMs,
        earlyExitFreeAtMs: perks.earlyExitFreeAtMs,
        earlyExitFeeBp: perks.earlyExitFeeBp,
        unbondingReadyAtMs: balances.unbondingReadyAtMs,
      },
      income: {
        stakingYieldNear,
        stakingYieldUsd: stakingYieldNear * nearUsd,
        marketFeeSavingsUsd: fills.marketFeeSavingsUsd,
        stallRoyaltiesUsd: fills.stallRoyaltiesUsd,
        patronRevenueUsd: patron.usd,
        selfFillsExcluded: fills.selfFillsExcluded,
      },
      projection: projectIncome(stakedNear, apy.netApyBp, nearUsd),
      effectiveApyBp: effectiveApyBp({ netApyBp: apy.netApyBp, stakedUsd: totalStakedUsd, windowMs, extrasUsd }),
      perks,
      aiBudget: buildAiBudgetView(perks, r.usage, r.nearUsd),
      ecosystem,
      series: buildSeries({ window, nowMs, events, stakedNear, netApyBp: apy.netApyBp, extraNearPerYear: toNear(extrasUsd) * (YEAR_MS / windowMs) }),
      txs: txs.slice(0, TX_LIST_LIMIT).map((t) => this.txRow(t, network)),
    });
  }

  private parsePerformanceQuery(rawAccountId: unknown, rawWindow: unknown, nowMs: number) {
    const accountId = typeof rawAccountId === 'string' ? rawAccountId.trim() : '';
    if (accountId.length < 2 || accountId.length > 64) {
      throw new CoreException('INVALID_REQUEST', { status: 400, message: 'accountId is required (2..64 chars)' });
    }
    const w = PerformanceWindow.safeParse(rawWindow ?? '30d');
    if (!w.success) throw new CoreException('INVALID_REQUEST', { status: 400, message: 'window must be 30d, 90d or 1y' });
    const window = w.data;
    const windowMs = WINDOW_MS[window];
    return { accountId, window, windowMs, sinceMs: nowMs - windowMs };
  }

  private loadWalletLedger(
    db: PrismaClient | undefined,
    wallet: Awaited<ReturnType<typeof resolveWalletPerks>>['wallet'],
    accountId: string,
    network: Network,
    nowMs: number,
    sinceMs: number,
    nearUsd: number,
    apy: ApyView,
  ) {
    if (!db) return Promise.resolve([EMPTY_BALANCES, [] as TxRecord[], EMPTY_FILL_INCOME, { usd: 0, events: [] }] as const);
    const timings = resolveStakingTimings(this.envBag());
    return Promise.all([
      readWalletBalances(db, wallet, {
        readMockWallet: network === 'mock',
        nowMs,
        primaryAccountId: accountId,
        readLiveWalletYocto: (acct) => this.readLiveWalletNearYocto(acct),
        rewardMultiplier: timings.rewardMultiplier,
        grossApyBp: apy.grossApyBp,
        protocolYieldShareBp: apy.protocolYieldShareBp,
      }),
      readStakingTxs(db, wallet, sinceMs),
      readFillIncome(db, wallet, { sinceMs, nearUsd }),
      readPatronIncome(db, wallet, sinceMs),
    ]);
  }

  private async readLiveWalletNearYocto(accountId: string): Promise<bigint> {
    if (!this.staking) return 0n;
    const fn = portHooks(this.staking).nearBalanceOf;
    if (!fn) return 0n;
    try {
      return BigInt((await fn(accountId)) || '0');
    } catch {
      return 0n;
    }
  }

  private txRow(t: TxRecord, network: Network): StakingTxRow {
    const base = network === 'mock' ? null : resolveNearNetworkConfig(this.envBag(), network).explorerBaseUrl;
    return { txHash: t.txHash, kind: t.kind, amountNear: nearText(t.amountYocto), asset: t.asset, atMs: t.atMs, explorerUrl: base ? `${base}/txns/${encodeURIComponent(t.txHash)}` : null };
  }

  private async apy(network: Network): Promise<ApyView> {
    let live: number | null = null;
    if (network === 'mainnet') {
      if (this.apyReader) {
        try {
          live = (await this.apyReader()) ?? null;
        } catch {
          live = null;
        }
      } else if (this.staking?.validatorApy) {
        try {
          const sample = await this.staking.validatorApy();
          if (sample.source === 'live' || sample.source === 'cached') live = sample.apyBp;
        } catch {
          live = null;
        }
      }
    }
    return buildApyView(network, live);
  }

  private network(): Network {
    return nearAdapterFor('Staking', this.envBag());
  }

  private envBag(): Record<string, string | undefined> {
    return (this.env ?? process.env) as Record<string, string | undefined>;
  }
}
