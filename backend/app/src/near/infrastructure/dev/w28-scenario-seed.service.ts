import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CANONICAL_PLANETS, CANONICAL_PLANET_LIST, isPatronageEligiblePlanetId, MARKET_TOKENS } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { EventBus } from '../../../bus/event-bus.js';
import { databaseEnabled } from '../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { PRISMA } from '../../../db/db.module.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { StakingPort } from '../../application/ports/staking.port.js';
import { creditVerifier } from '../adapters/mock/intents-ledger.js';
import { nearAdapterFor } from '../adapter-selection.js';
import { NEAR_WALLET_PROVIDER } from '../../staking/perks/stake-clock.reader.js';
import { stakingNowMs } from '../../staking/perks/perks-deps.js';
import { PatronNominateService } from '../../staking/services/patron-nominate.service.js';
import { StakingService } from '../../staking/staking.service.js';

/** Rival whale that holds the Lead Patron seat until the pilot out-stakes it (demo step 6). */
export const W28_RIVAL_ACCOUNT = 'w28-rival.terraagent.mock';
export const W28_RIVAL_STAKE_NEAR = '500';
export const W28_PILOT_FUND_NEAR = '1000';
/** Only the three canonical worlds hold Planetary Patronage seats; dev `w28` seeds Granite Hollow by default. */
export const W28_PATRON_PLANET_ID = CANONICAL_PLANETS.temperate.id;
/** Bound on seats buffered before their planet's `created` event (dev only; never grows without limit). */
const MAX_EARLY_PLANETS = 64;
/** USDC "trade profits" for the Stake-Trade-Profits demo (step 7), in 6-decimal atomic units. */
export const W28_PILOT_USDC_ATOMIC = 50_000_000n;

/**
 * The pilot's linked NEAR wallet for a seated player: stable, valid `AccountId`, unique per player. `.mock` keeps every
 * client network guess (`detectStakingNetwork`) on the mock REST path.
 */
export function w28PilotAccountId(playerId: string): string {
  return `w28-${createHash('sha256').update(playerId).digest('hex').slice(0, 10)}.terraagent.mock`;
}

/**
 * Seeds the `w28` scenario (W28 Staking Overhaul demo, `tests/scenarios/w28-staking-overhaul.ts`). Staking is wallet
 * state, never sim state (D-31), so it is written here and not by the scenario:
 * - `dev.scenario.created`: a rival wallet stakes 500 NEAR and nominates the planet (King-of-the-Hill incumbent).
 * - `dev.scenario.seated`: the seated player gets a linked NEAR wallet (`social_identity`, so `/me.html` shows the
 *   wealth dashboard and the pilot counts as verified for the 5-turn trial), 1000 mock NEAR and 50 USDC profits.
 * Every run resets the two wallets' staking rows, so the demo is repeatable. No-op with `W28` off, without a DB, or
 * when the Staking / Intents ports are not mock (never signs on a real network).
 */
@Injectable()
export class W28ScenarioSeedService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(W28ScenarioSeedService.name);
  private readonly stops: Array<() => void> = [];
  private readonly planets = new Set<string>();
  /** Seats that arrived before their planet's `created` event (the WS join can win the race). */
  private readonly early = new Map<string, string[]>();
  /** Planets of other scenarios: their seats are not ours. */
  private readonly others = new Set<string>();
  /**
   * Pilots already seeded by this process. The WS emits `seated` on every dev join / reconnect and every
   * `?scenario=w28` load creates a new planet, so a page reload must not wipe the demo wallet: one seed per pilot
   * (a fresh demo uses a new `as=` name, or an app restart).
   */
  private readonly seeded = new Set<string>();
  private pending: Promise<void> = Promise.resolve();

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(StakingService) private readonly staking: StakingService,
    @Inject(StakingPort) private readonly port: StakingPort,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (!this.bus || this.stops.length > 0) return;
    this.stops.push(
      this.bus.on('dev.scenario.created', (e) => {
        if (e.scenario !== 'w28') {
          this.early.delete(e.planetId); // seats buffered for a planet that turned out not to be w28
          this.others.add(e.planetId);
          return;
        }
        this.planets.add(e.planetId);
        this.queue('rival', () => this.seedRival(e.planetId));
        for (const playerId of this.early.get(e.planetId) ?? []) this.seatOnce(playerId);
        this.early.delete(e.planetId);
      }, { module: 'W28ScenarioSeedService' }),
      this.bus.on('dev.scenario.seated', (e) => {
        if (this.others.has(e.planetId)) return;
        if (!this.planets.has(e.planetId)) {
          if (this.early.size >= MAX_EARLY_PLANETS) this.early.clear();
          this.early.set(e.planetId, [...(this.early.get(e.planetId) ?? []), e.playerId]);
          return;
        }
        this.seatOnce(e.playerId);
      }, { module: 'W28ScenarioSeedService' }),
    );
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  /** Resolves when every queued seed step has finished (tests, dev tools). */
  waitForSeed(): Promise<void> {
    return this.pending;
  }

  async seedRival(planetId: string): Promise<void> {
    const db = this.db();
    if (!db) return;
    for (const def of CANONICAL_PLANET_LIST) {
      await db.planet.upsert({
        where: { id: def.id },
        create: { id: def.id, name: def.name, type: def.type, look: def.look, seed: def.seed, admission: 'OPEN' },
        update: { admission: 'OPEN' },
      });
    }
    const patronPlanetId = isPatronageEligiblePlanetId(planetId) ? planetId : W28_PATRON_PLANET_ID;
    await this.resetWallet(db, W28_RIVAL_ACCOUNT);
    const pool = await this.defaultPool();
    await this.staking.fundWalletNear(W28_RIVAL_ACCOUNT, '600');
    await this.staking.stake({ accountId: W28_RIVAL_ACCOUNT, pool, amount: W28_RIVAL_STAKE_NEAR, opId: `w28-rival-stake:${planetId}:${Date.now()}` }); // fresh op per seed: the wallet was just reset
    await new PatronNominateService(() => db, stakingNowMs).nominate(W28_RIVAL_ACCOUNT, patronPlanetId);
  }

  async seedPilot(playerId: string): Promise<string | null> {
    const db = this.db();
    if (!db) return null;
    const accountId = w28PilotAccountId(playerId);
    await db.socialIdentity.upsert({
      where: { id: `si_w28_${accountId}` },
      create: { id: `si_w28_${accountId}`, playerId, provider: NEAR_WALLET_PROVIDER, subject: accountId, accountId },
      update: { playerId },
    });
    await this.resetWallet(db, accountId);
    await db.aiFreeTrial.deleteMany({ where: { playerId } });
    await this.staking.fundWalletNear(accountId, W28_PILOT_FUND_NEAR);
    await creditVerifier(db, accountId, MARKET_TOKENS.USDC.verifierId, W28_PILOT_USDC_ATOMIC);
    return accountId;
  }

  private async resetWallet(db: PrismaClient, accountId: string): Promise<void> {
    await db.mockChainStaking.deleteMany({ where: { accountId } });
    await db.stakingPosition.deleteMany({ where: { accountId } });
    await db.stakingTx.deleteMany({ where: { accountId } });
    await db.stakingPatronNomination.deleteMany({ where: { accountId } });
    await db.stakingPatronSeat.deleteMany({ where: { accountId } });
    await db.aiWalletUsage.deleteMany({ where: { walletKey: accountId } });
    await db.$executeRaw`DELETE FROM chain.mock_chain_intents_balance WHERE account_id = ${accountId}`;
    await db.$executeRaw`DELETE FROM chain.mock_chain_balance WHERE account_id = ${accountId}`;
    this.staking.walletBalancesYocto.delete(accountId);
  }

  private async defaultPool(): Promise<string> {
    const pools = await this.port.listPools();
    const first = pools[0];
    if (!first) throw new Error('no whitelisted staking pool');
    return first.poolId;
  }

  /** Only on mock chains: the seed stakes and credits through the ports, which on testnet would sign real txs. */
  private db(): PrismaClient | null {
    if (!this.flags.has('W28') || !this.prisma) return null;
    const envMap = (this.env ?? process.env) as Record<string, string | undefined>;
    if (nearAdapterFor('Staking', envMap) !== 'mock' || nearAdapterFor('Intents', envMap) !== 'mock') return null;
    return this.env === undefined || databaseEnabled(this.env) ? this.prisma : null;
  }

  private seatOnce(playerId: string): void {
    if (this.seeded.has(playerId)) return;
    this.seeded.add(playerId);
    this.queue('pilot', () => this.seedPilot(playerId));
  }

  private queue(step: string, run: () => Promise<unknown>): void {
    this.pending = this.pending
      .then(run)
      .then(() => undefined)
      .catch((err: unknown) => this.log.warn(`w28 scenario ${step} seed failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}
