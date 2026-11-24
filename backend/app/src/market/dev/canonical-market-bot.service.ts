import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { CANONICAL_PLANET_LIST } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { MarketConfig } from '@terra/sim';
import type { PlanetEventOf } from '../../bus/channels.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { PlanetLifecycleService } from '../../game/lifecycle/planet-lifecycle.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import type { JobRegistration } from '../../jobs/recurring.js';
import { kekEnv } from '../../near/identity/colony-accounts.js';
import { nearAdapterFor } from '../../near/infrastructure/adapter-selection.js';
import { loadKekRing } from '../../near/keystore/kek.js';
import { KeyStore } from '../../near/keystore/keys.js';
import { ensureVerifierBalance } from '../guild/offers/signers.js';
import { OrderRelease } from '../orders/cancel-order.service.js';
import { resolveMarketAccountId } from '../orders/colony-account.js';
import { MarketPolicyProvider } from '../orders/market-policy.provider.js';
import { PlaceOrderService } from '../orders/place-order.service.js';
import {
  BOT_FUNDING_AMOUNTS,
  buildBootstrapCrosses,
  buildLadderSpecs,
  buildLiveCross,
  buildRebalanceCrosses,
  CANONICAL_BOT_PAIRS,
  CANONICAL_MARKET_BOTS,
  canonicalBotColonyId,
  resolveBotPlanetType,
  type BotCrossSpec,
  type BotWorldTarget,
  type CanonicalBotPairSpec,
  type CanonicalMarketBotDef,
} from './canonical-market-bot.plan.js';
import { ensureCustodialAccount } from './market-accounts.bootstrap.js';

export const CANONICAL_BOT_TICK_MS = 30_000;
const BOOTSTRAP_TRADES_PER_PAIR = 5;
const THREE_HOURS_MS = 3 * 3_600_000;
const ONE_DAY_S = 86_400;
const ARCHIVED_PLANET_STATUSES = ['ENDED', 'PLANET_ENDED', 'ARCHIVED'];

/**
 * Keeps every active planet (the 3 canonical worlds AND all live loaded/DB worlds)
 * populated with real bot-vs-bot matched trades (signed via NEP-413 Intents and settled
 * through `ChainOutbox` + `TradeSettlement`) plus resting bid/ask depth across 10 pairs.
 */
@Injectable()
export class CanonicalMarketBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(CanonicalMarketBotService.name);
  private job: JobRegistration | null = null;
  private seq = 0;
  private tickSeq = 0;
  private seeding = false;
  private ticking = false;
  private destroyed = false;

  constructor(
    private readonly place: PlaceOrderService,
    private readonly policy: MarketPolicyProvider,
    private readonly release: OrderRelease,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly flags: FlagsService,
    @Optional() private readonly keyStore?: KeyStore,
    @Optional() private readonly gamePlanets?: GamePlanets,
    @Optional() private readonly lifecycle?: PlanetLifecycleService,
    @Optional() private readonly jobs?: JobsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) return;
    this.gamePlanets?.onPlanetLoaded((planetId) => {
      if (!this.seeding && !this.destroyed) {
        void this.seedPlanetById(planetId).catch((err: unknown) => {
          this.log.warn(`bot market load seed failed for ${planetId}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    });
    void this.seedAllAndStartLoop().catch((err: unknown) => {
      this.log.warn(`canonical bot market seed failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    // One tick per interval across the cluster (3.8), on a sim host (discovery reads its loaded planets).
    this.job = this.jobs?.recurring({ name: 'market.canonical-bots', scope: 'sim-host', schedule: { everyMs: CANONICAL_BOT_TICK_MS }, run: () => this.tickLiveActivity() }) ?? null;
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    const job = this.job;
    this.job = null;
    await job?.stop();
  }

  private enabled(): boolean {
    if (!this.env || this.env.NODE_ENV === 'test' || !databaseEnabled(this.env) || !this.flags.has('W13')) {
      return false;
    }
    const envBag = this.env as unknown as Record<string, string | undefined>;
    if (this.env.NODE_ENV === 'production' && nearAdapterFor('Intents', envBag) === 'mainnet') return false;
    return this.env.NODE_ENV === 'production' || this.env.TA_SEED_RIVAL_AI === '1' || this.env.TA_SEED_RIVAL_AI === 'true';
  }

  private async seedAllAndStartLoop(): Promise<void> {
    this.seeding = true;
    try {
      await this.prisma.intentTrade.deleteMany({ where: { tradeId: { startsWith: 'cbtr_' } } }).catch(() => undefined);
      await this.policy.refresh();
      const worlds = await this.discoverActiveWorlds();
      for (const world of worlds) {
        if (this.destroyed) return;
        await this.ensurePlanetSeeded(world);
      }
      this.log.log(`real bot market trading ready across ${worlds.length} worlds (${CANONICAL_BOT_PAIRS.length} pairs)`);
    } finally {
      this.seeding = false;
    }
  }

  async discoverActiveWorlds(): Promise<BotWorldTarget[]> {
    const byId = new Map<string, BotWorldTarget>();
    for (const p of CANONICAL_PLANET_LIST) {
      byId.set(p.id, { id: p.id, type: p.type });
    }
    const dbPlanets = await this.prisma.planet.findMany({
      where: { state: { notIn: ARCHIVED_PLANET_STATUSES }, lifecycle: { not: 'ARCHIVED' } },
      select: { id: true, type: true },
    });
    for (const p of dbPlanets) {
      if (!byId.has(p.id)) byId.set(p.id, { id: p.id, type: resolveBotPlanetType(p.id, p.type) });
    }
    for (const id of this.gamePlanets?.loadedIds() ?? []) {
      if (!byId.has(id)) byId.set(id, { id, type: resolveBotPlanetType(id) });
    }
    // Idle-unloaded planets (3.5) get no bot trades until a player wakes them.
    for (const id of (await this.lifecycle?.dormantIds().catch(() => [])) ?? []) byId.delete(id);
    return [...byId.values()];
  }

  async seedPlanetById(planetId: string): Promise<void> {
    if (this.destroyed) return;
    const row = await this.prisma.planet.findUnique({ where: { id: planetId }, select: { type: true } }).catch(() => null);
    await this.ensurePlanetSeeded({ id: planetId, type: resolveBotPlanetType(planetId, row?.type) });
  }

  async ensurePlanetSeeded(planet: BotWorldTarget): Promise<void> {
    await this.ensureBotAccounts(planet.id);
    const cfg = this.policy.current();
    for (let i = 0; i < CANONICAL_BOT_PAIRS.length; i++) {
      if (this.destroyed) return;
      const spec = CANONICAL_BOT_PAIRS[i]!;
      if (!cfg.pairs.some((p) => p.pair === spec.pair)) continue;
      await this.healPairBotOrders(planet, i, spec);
      await this.ensureRealPairTrades(planet, spec, cfg);
      await this.ensurePairBook(planet, i, spec, cfg);
    }
  }

  async tickLiveActivity(): Promise<void> {
    if (this.ticking || this.seeding || this.destroyed) return;
    this.ticking = true;
    try {
      const seq = this.tickSeq++;
      const pairIndex = seq % CANONICAL_BOT_PAIRS.length;
      const pairRound = Math.floor(seq / CANONICAL_BOT_PAIRS.length);
      const spec = CANONICAL_BOT_PAIRS[pairIndex]!;
      const cfg = this.policy.current();
      if (!cfg.pairs.some((p) => p.pair === spec.pair)) return;
      const worlds = await this.discoverActiveWorlds();
      for (let w = 0; w < worlds.length; w++) {
        if (this.destroyed) return;
        const world = worlds[w]!;
        await this.ensureBotAccounts(world.id);
        await this.executeRealBotCross(world.id, spec, buildLiveCross(world.type, spec, pairRound * 3 + w), cfg);
        await this.healPairBotOrders(world, pairIndex, spec);
        await this.ensurePairBook(world, pairIndex, spec, cfg);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async healPairBotOrders(planet: BotWorldTarget, pairIndex: number, spec: CanonicalBotPairSpec): Promise<void> {
    const ladderKeys = new Set(
      buildLadderSpecs(pairIndex, planet.type, spec).map((l) => `${l.side}:${l.priceAmount.toString()}`),
    );
    const openRows = await this.prisma.marketOrder.findMany({
      where: {
        planetId: planet.id,
        pair: spec.pair,
        actorKind: 'bot',
        ref: { startsWith: 'cbot:' },
        state: { in: ['OPEN', 'PARTIAL'] },
      },
      select: { orderId: true, side: true, priceAmount: true },
    });
    for (const row of openRows) {
      if (this.destroyed) return;
      if (ladderKeys.has(`${row.side}:${row.priceAmount.toFixed(0)}`)) continue;
      await this.place.matchAndSettle(row.orderId).catch(() => undefined);
      const after = await this.prisma.marketOrder.findUnique({
        where: { orderId: row.orderId },
        select: { state: true },
      });
      if (after && (after.state === 'OPEN' || after.state === 'PARTIAL')) {
        await this.release.release(row.orderId, 'cancelled').catch(() => undefined);
      }
    }
  }

  private async ensureBotAccounts(planetId: string): Promise<void> {
    const keys = this.keyStore ?? new KeyStore(loadKekRing(kekEnv(this.env)));
    for (const bot of CANONICAL_MARKET_BOTS) {
      const colonyId = canonicalBotColonyId(planetId, bot.slug);
      const accountId = await resolveMarketAccountId(this.prisma, colonyId, null, planetId, bot.colonyIndex);
      await ensureCustodialAccount(this.prisma, keys, accountId, { playerId: bot.playerId, slot: colonyId });
      for (const [token, amount] of BOT_FUNDING_AMOUNTS) {
        await ensureVerifierBalance(this.prisma, accountId, token, amount, this.env);
      }
    }
  }

  private async ensureRealPairTrades(planet: BotWorldTarget, spec: CanonicalBotPairSpec, cfg: MarketConfig): Promise<void> {
    const since = new Date(Date.now() - THREE_HOURS_MS);
    const recent = await this.prisma.intentTrade.findMany({
      where: {
        planetId: planet.id,
        pair: spec.pair,
        organic: true,
        state: { in: ['FINAL', 'PENDING'] },
        createdAt: { gte: since },
      },
      select: { buyerColonyId: true, sellerColonyId: true, amount: true },
    });
    const crosses =
      recent.length < BOOTSTRAP_TRADES_PER_PAIR
        ? buildBootstrapCrosses(planet.type, spec, BOOTSTRAP_TRADES_PER_PAIR - recent.length)
        : buildRebalanceCrosses(
            planet.id,
            planet.type,
            spec,
            recent.map((r) => ({
              buyerColonyId: r.buyerColonyId,
              sellerColonyId: r.sellerColonyId,
              amount: BigInt(r.amount.toFixed(0)),
            })),
          );
    for (const cross of crosses) {
      if (this.destroyed) return;
      await this.executeRealBotCross(planet.id, spec, cross, cfg);
    }
  }

  async executeRealBotCross(
    planetId: string,
    spec: CanonicalBotPairSpec,
    cross: BotCrossSpec,
    cfg: MarketConfig,
  ): Promise<void> {
    const stamp = Date.now();
    await this.placeBotOrder(planetId, spec, cross.sellerBot, { side: 'sell', amount: cross.amount, priceAmount: cross.priceAmount }, cfg, stamp);
    await this.placeBotOrder(planetId, spec, cross.buyerBot, { side: 'buy', amount: cross.amount, priceAmount: cross.priceAmount }, cfg, stamp);
  }

  private async ensurePairBook(
    planet: BotWorldTarget,
    pairIndex: number,
    spec: CanonicalBotPairSpec,
    cfg: MarketConfig,
  ): Promise<void> {
    const openRows = await this.prisma.marketOrder.findMany({
      where: {
        planetId: planet.id,
        pair: spec.pair,
        state: { in: ['OPEN', 'PARTIAL'] },
        actorKind: 'bot',
        expiresAt: { gt: new Date() },
      },
      select: { side: true, priceAmount: true },
    });
    const openKeys = new Set(openRows.map((r) => `${r.side}:${r.priceAmount.toFixed(0)}`));
    const buyCount = openRows.filter((r) => r.side === 'buy').length;
    const sellCount = openRows.filter((r) => r.side === 'sell').length;
    if (buyCount >= 3 && sellCount >= 3) return;
    const levels = buildLadderSpecs(pairIndex, planet.type, spec);
    const stamp = Date.now();
    for (const lvl of levels) {
      if ((lvl.side === 'buy' && buyCount >= 3) || (lvl.side === 'sell' && sellCount >= 3)) continue;
      if (openKeys.has(`${lvl.side}:${lvl.priceAmount.toString()}`)) continue;
      const bot = CANONICAL_MARKET_BOTS[lvl.botIndex]!;
      await this.placeBotOrder(planet.id, spec, bot, lvl, cfg, stamp);
    }
  }

  private async placeBotOrder(
    planetId: string,
    spec: CanonicalBotPairSpec,
    bot: CanonicalMarketBotDef,
    lvl: { readonly side: 'buy' | 'sell'; readonly amount: number; readonly priceAmount: bigint },
    cfg: MarketConfig,
    stamp: number,
  ): Promise<void> {
    const colonyId = canonicalBotColonyId(planetId, bot.slug);
    const openByColony = await this.prisma.marketOrder.count({
      where: { planetId, colonyId, state: { in: ['OPEN', 'PARTIAL'] } },
    });
    if (openByColony >= cfg.openOrderLimit - 1) return;
    const seq = ++this.seq;
    const ref = `cbot:${bot.slug}:${spec.pair}:${lvl.side}:${stamp}:${seq}`;
    const event = {
      planetId,
      tick: 0,
      kind: 'marketOrderRequested',
      severity: 'info',
      colonyIds: [colonyId],
      data: {
        ref,
        orderSeq: seq,
        colonyId,
        colonyIndex: bot.colonyIndex,
        playerId: bot.playerId,
        side: lvl.side,
        resource: spec.base,
        amount: lvl.amount,
        price: { token: spec.quote, amount: lvl.priceAmount.toString() },
        ttlS: ONE_DAY_S,
        stallFeeBp: bot.stallFeeBp,
        ...(lvl.side === 'buy' ? { maxStallFeeBp: cfg.stallFeeMaxBp } : {}),
        hubEntityId: 0,
        stallName: bot.stallName,
        actorKind: 'bot',
      },
    } as unknown as PlanetEventOf<'marketOrderRequested'>;
    await this.place.handle(event, { actorKind: 'bot', answerSim: false });
  }
}
