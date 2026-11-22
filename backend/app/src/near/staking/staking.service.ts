import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  STAKING_RULES,
  type CompoundYieldRequest,
  type Nep413Signature,
  type StakeProfitsRequest,
  type StakeProfitsResponse,
  type StakeRequest,
  type StakingActionResponse,
  type StakingStatusResponse,
  type UnstakeRequest,
  type WithdrawRequest,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { CoreException } from '../../core/errors/index.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { IntentsBalanceReadPort } from '../application/ports/intents-balance-read.port.js';
import { StakingPort } from '../application/ports/staking.port.js';
import { DeedTelemetryService } from '../deed/deed-telemetry.service.js';
import { DeedRepository } from '../deed/deed.repository.js';
import { AccountClaimService } from './account-claim.service.js';
import { ActionEffects } from './services/action-effects.js';
import { ActionFinisher, OpNonce } from './services/action-finisher.js';
import { ColonyStakeFlow } from './services/colony-stake.flow.js';
import { PatronNominateService, type PatronNominationResult } from './services/patron-nominate.service.js';
import { PerksView } from './services/perks-view.js';
import { portHooks, stakingNowMs } from './services/port-hooks.js';
import { StakeProfitsService } from './services/stake-profits.service.js';
import { StakingStatusReader, type StakingStatusQuery } from './services/status.reader.js';
import { StakingTxWriter } from './services/staking-tx.writer.js';
import { WalletBalances, type FundWalletNearResult } from './services/wallet-balances.js';
import { requireWalletAccount, WalletStakeFlow } from './services/wallet-stake.flow.js';
import { StakingPositionSyncService } from './staking-position-sync.service.js';
import { type FullAccessKeyVerifier } from './staking-signature-guard.js';
import { buildStakingWalletTxDescriptor, type StakingWalletTxDescriptor, type StakingWalletTxQuery } from './staking-wallet-tx.js';
import { nearToYocto, stakeOpId, unstakeOpId, withdrawOpId, yoctoToNear } from './yocto.js';
import { releasePerksClock, setPerksDeps } from './perks/perks-deps.js';

export { nearToYocto, stakeOpId, unstakeOpId, withdrawOpId, yoctoToNear };
export type { FundWalletNearResult, StakingStatusQuery };

type Signed<T> = T & { readonly signature?: Nep413Signature };

/**
 * Thin orchestrator of the staking domain (`W20-18`, `NEAR-92`, `D-18`, `W28-04`). It owns no rules: each action goes to
 * `ColonyStakeFlow` (the W20 deed + claim gates, used while `W28` is off or for a colony-scoped request) or to
 * `WalletStakeFlow` / `StakeProfitsService` / `PatronNominateService` (wallet-first, `W28` only), and reads go through
 * `StakingStatusReader`. The wave flag decides which: with `W28` off every W20 behaviour holds exactly.
 */
@Injectable()
export class StakingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StakingService.name);
  private readonly stops: Array<() => void> = [];
  /** The staking clock this service installed into the perks engine (released on shutdown). */
  private perksClock: (() => number) | null = null;
  private readonly balances: WalletBalances;
  private readonly colony: ColonyStakeFlow;
  private readonly wallet: WalletStakeFlow;
  private readonly profits: StakeProfitsService;
  private readonly patron: PatronNominateService;
  private readonly status: StakingStatusReader;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(StakingPort) private readonly staking: StakingPort,
    @Inject(DeedRepository) deeds: DeedRepository,
    @Inject(AccountClaimService) claimService: AccountClaimService,
    @Inject(StakingPositionSyncService) private readonly positionSync: StakingPositionSyncService,
    @Optional() @Inject(GamePlanets) private readonly planets?: GamePlanets,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(DeedTelemetryService) telemetry?: DeedTelemetryService,
    @Optional() keyVerifier?: FullAccessKeyVerifier,
    @Optional() @Inject(IntentsBalanceReadPort) intentsRead?: IntentsBalanceReadPort,
  ) {
    const envBag = () => (this.env ?? process.env) as Record<string, string | undefined>;
    const db = () => (databaseEnabled(this.env) && this.prisma ? this.prisma : null);
    const nonce = new OpNonce();
    const finisher = new ActionFinisher(staking, positionSync);
    const perks = new PerksView(staking, envBag, db);
    const effects = new ActionEffects(staking, new StakingTxWriter(db), envBag);
    this.balances = new WalletBalances(staking, db);
    const common = { staking, balances: this.balances, finisher, nonce, env: envBag, db, keyVerifier };
    this.colony = new ColonyStakeFlow({
      ...common,
      deeds,
      claimService,
      telemetry,
      effects,
      isW28: () => this.flags.has('W28'),
      perksAfter: (accountId, position) =>
        this.flags.has('W28')
          ? perks.evaluate({ accountId, grossApyBp: position.apyBp ?? STAKING_RULES.simGrossApyBp, positions: [position] })
          : Promise.resolve(undefined),
    });
    this.wallet = new WalletStakeFlow({ ...common, perks, effects });
    this.profits = new StakeProfitsService({ ...common, perks, effects, intentsRead });
    this.patron = new PatronNominateService(db, () => stakingNowMs(staking));
    this.status = new StakingStatusReader({ flags, staking, claimService, positionSync, balances: this.balances, colony: this.colony, perks, env: envBag });
  }

  get walletBalancesYocto(): Map<string, bigint> {
    return this.balances.cache;
  }

  onModuleInit(): void {
    const port = this.staking;
    if (port.clockNowMs) {
      this.perksClock = () => port.clockNowMs?.() ?? Date.now();
      setPerksDeps({ clock: this.perksClock });
    }
    if (this.stops.length > 0 || !this.planets) return;
    this.stops.push(
      this.planets.onWarp((_planetId, k) => {
        if (k > 1 && this.flags.has('W20')) {
          this.advanceClockMs(k * 3_600_000);
          void this.positionSync.syncAll().catch((err: unknown) => {
            this.log.warn(`staking read-model sync after a warp failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      }),
    );
  }

  onModuleDestroy(): void {
    if (this.perksClock) releasePerksClock(this.perksClock);
    for (const stop of this.stops.splice(0)) stop();
  }

  advanceClockMs(deltaMs: number): void {
    portHooks(this.staking).advanceClockMs?.(deltaMs);
  }

  advanceGameDays(days: number): void {
    const hooks = portHooks(this.staking);
    if (hooks.advanceGameDays) {
      hooks.advanceGameDays(days);
      return;
    }
    this.advanceClockMs(days * 86_400_000);
  }

  /** `true` while the W28 wallet-first behaviour is on. */
  isWalletFirst(): boolean {
    return this.flags.has('W28');
  }

  async fundWalletNear(accountId: string, amountNear: string | number): Promise<FundWalletNearResult> {
    this.assertWaveEnabled();
    return this.balances.fund(accountId, amountNear);
  }

  async getStatus(query?: StakingStatusQuery): Promise<StakingStatusResponse> {
    this.assertWaveEnabled();
    return this.status.read(query);
  }

  async stake(input: Signed<StakeRequest>): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    return this.isWalletAction(input) ? this.wallet.stake(input) : this.colony.stake(input);
  }

  async unstake(input: Signed<UnstakeRequest>): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    return this.isWalletAction(input) ? this.wallet.unstake(input) : this.colony.unstake(input);
  }

  async withdraw(input: Signed<WithdrawRequest & { readonly amount?: string }>): Promise<StakingActionResponse> {
    this.assertWaveEnabled();
    return this.isWalletAction(input) ? this.wallet.withdraw(input) : this.colony.withdraw(input);
  }

  /** `POST /v1/near/stake/compound` (`W28` only): accrued 80 % yield becomes principal, `0 %` fee, clocks untouched. */
  async compound(input: Signed<CompoundYieldRequest>): Promise<StakingActionResponse> {
    this.assertW28();
    return this.wallet.compound({ ...input, accountId: await this.targetAccount(input) });
  }

  /** `POST /v1/near/stake/profits` (`W28` only): quote, and on the mock chain swap and stake, the wallet's `USDC` profit. */
  async stakeProfits(input: Signed<StakeProfitsRequest>): Promise<StakeProfitsResponse> {
    this.assertW28();
    return this.profits.run({ ...input, accountId: await this.targetAccount(input) });
  }

  /** `POST /v1/near/staking/patron/nominate` (`W28` only). */
  nominatePatron(accountId: string, planetId: string): Promise<PatronNominationResult> {
    this.assertW28();
    return this.patron.nominate(requireWalletAccount(accountId), planetId);
  }

  readWalletBalanceNear(candidates: string | readonly (string | null | undefined)[]): Promise<string> {
    return this.balances.readNear(candidates);
  }

  walletTxDescriptor(query: StakingWalletTxQuery): StakingWalletTxDescriptor {
    return buildStakingWalletTxDescriptor(query, (this.env ?? process.env) as Record<string, string | undefined>);
  }

  async resolveColonyOwnerPlayerId(colonyId?: string): Promise<string | null> {
    return (await this.colony.resolveDeed(colonyId))?.playerId ?? null;
  }

  /** Wallet-first only when `W28` is on and the request names the wallet; a colony-scoped request keeps the W20 gates. */
  private isWalletAction(input: { readonly accountId?: string }): boolean {
    return this.flags.has('W28') && Boolean(input.accountId?.trim());
  }

  /** The wallet a W28 request acts on: its `accountId`, else the claimed account of its colony; otherwise `WALLET_REQUIRED`. */
  private async targetAccount(input: { readonly accountId?: string; readonly colonyId?: string }): Promise<string> {
    const named = input.accountId?.trim();
    if (named) return named;
    if (!input.colonyId?.trim()) return requireWalletAccount(undefined);
    return (await this.colony.requireSettledAndClaimed(input.colonyId)).claimInfo.accountId;
  }

  private assertWaveEnabled(): void {
    if (!this.flags.has('W20')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }

  private assertW28(): void {
    if (!this.flags.has('W28')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
}
