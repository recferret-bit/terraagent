import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { marketTradeOpId, type MarketResourceDeltas, type MarketSettledArgs, type MarketTradePayload } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { ChainOutboxRepository, type ClaimedRow } from '../../near/application/outbox/chain-outbox.repository.js';
import { OutboxListeners } from '../../near/application/outbox/outbox-listeners.js';
import { MarketMetrics } from '../telemetry/market-metrics.js';
import { MarketSimGateway } from '../orders/market-sim-gateway.js';
import { IntentTradeRepository } from './intent-trade.repository.js';
import type { SettleParty, TradePlan } from './trade-plan.js';

/** `market.trade` push: one message per FINAL trade, broadcast to the planet's sockets by `WsGateway`. */
export interface MarketTradeBusEvent {
  readonly planetId: string;
  readonly payload: MarketTradePayload;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'market.trade': MarketTradeBusEvent;
  }
}

const TRADE_OP = /^trade:/;
const NOTIFIED = 'notified';

/**
 * Finishes a trade after its `Intents.execute` outbox row is DONE (W13-13): marks `chain.intent_trade` FINAL exactly once
 * (conditional update), then tells both sims (`market.settled` to buyer, seller and the maker's stall) and pushes
 * `market.trade`. A crash between the relay's DONE write and this step is repaired by `recover()` (run at boot): it
 * finalizes every PENDING trade whose outbox row is DONE. Execute itself is idempotent by opId, so a re-claimed row never
 * changes the ledger twice.
 */
@Injectable()
export class TradeSettlement implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TradeSettlement.name);
  private off: (() => void) | null = null;

  constructor(
    private readonly trades: IntentTradeRepository,
    private readonly outbox: ChainOutboxRepository,
    private readonly gateway: MarketSimGateway,
    private readonly bus: EventBus,
    private readonly listeners: OutboxListeners,
    private readonly metrics: MarketMetrics,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit(): void {
    this.off ??= this.listeners.onDone(async (row, _res, txHash) => { await this.onRowDone(row, txHash); });
    if (databaseEnabled(this.env)) void this.recover().catch((e: unknown) => this.log.warn(`trade recovery failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
  }

  async onRowDone(row: Pick<ClaimedRow, 'opId' | 'port' | 'method' | 'payload'>, txHash: string | null): Promise<boolean> {
    if (row.port !== 'Intents' || row.method !== 'execute' || !TRADE_OP.test(row.opId)) return false;
    const plan = (row.payload as { trade?: TradePlan }).trade;
    if (!plan) return false;
    return this.finalize(plan, txHash);
  }

  /** FINAL once; the sims and sockets are told only by the call that made the transition. Returns whether it did. */
  async finalize(plan: TradePlan, txHash: string | null): Promise<boolean> {
    if (!(await this.trades.finalize(plan.tradeId, txHash))) return false;
    await this.notify(plan, txHash);
    return true;
  }

  /** Tells the sims and the sockets, then records that it was done (`notified` in the outbox payload) so a restart does not repeat or skip it. */
  async notify(plan: TradePlan, txHash: string | null): Promise<void> {
    this.metrics.tradeFinal(plan);
    const stallName = await this.stallNameOf(plan); // for the contract toast and history row (W13-35)
    for (const party of plan.parties) this.settleSim(plan, party, txHash, stallName);
    this.pushTrade(plan, txHash);
    await this.outbox.flagPayload(marketTradeOpId(plan.tradeId), NOTIFIED);
  }

  /**
   * Boot recovery: (1) finalizes open trades whose execute row is DONE (died between the relay's DONE and FINAL); (2) re-sends the
   * notifications of FINAL trades whose `notified` flag is missing (died between FINAL and the sends; the sim dedupes by trade
   * id and role, so a repeat is harmless). Returns how many trades it completed.
   */
  async recover(): Promise<number> {
    let n = 0;
    for (const t of await this.trades.inFlight()) {
      const row = await this.outbox.find(marketTradeOpId(t.tradeId));
      if (row?.status !== 'DONE') continue;
      const plan = (row.payload as { trade?: TradePlan }).trade;
      if (plan && (await this.finalize(plan, row.txHash))) n++;
    }
    for (const row of await this.outbox.doneWithoutFlag('trade:', NOTIFIED)) {
      const plan = (row.payload as { trade?: TradePlan }).trade;
      const trade = plan ? await this.trades.find(plan.tradeId) : null;
      if (plan && trade?.state === 'FINAL') { await this.notify(plan, trade.txHash); n++; }
    }
    return n;
  }

  private async stallNameOf(plan: TradePlan): Promise<string | undefined> {
    const stall = plan.parties.find((x) => x.role === 'stall');
    if (!stall) return undefined;
    const row = await this.prisma.marketStall.findUnique({ where: { planetId_colonyId: { planetId: plan.planetId, colonyId: stall.colonyId } }, select: { name: true } }).catch(() => null);
    return row?.name ?? undefined;
  }

  private settleSim(plan: TradePlan, p: SettleParty, txHash: string | null, stallName?: string): void {
    const args: Omit<MarketSettledArgs, 'colonyId' | 'colonyIndex'> = {
      tradeId: plan.tradeId, role: p.role, ...(p.ref ? { ref: p.ref } : {}),
      deltas: p.deltas as MarketResourceDeltas,
      ...(Object.keys(p.released).length > 0 ? { released: p.released as MarketResourceDeltas } : {}),
      trade: {
        base: plan.base as MarketSettledArgs['trade']['base'], amount: plan.qty, quote: plan.quote as MarketSettledArgs['trade']['quote'],
        notional: plan.notional, platformFee: plan.platformFee, stallFee: plan.stallFee, stallFeeBp: plan.stallFeeBp, makerSide: plan.makerSide,
        ...(stallName ? { stallName } : {}),
        ...(txHash ? { txHash } : {}),
      },
    };
    this.gateway.settled({ planetId: plan.planetId, colonyId: p.colonyId, colonyIndex: p.colonyIndex }, args);
  }

  private pushTrade(plan: TradePlan, txHash: string | null): void {
    this.bus.emit('market.trade', {
      planetId: plan.planetId,
      payload: {
        planetId: plan.planetId,
        trade: {
          tradeId: plan.tradeId, pair: plan.pair, base: plan.base as never, quote: plan.quote as never, amount: plan.qty, notional: plan.notional,
          platformFee: plan.platformFee, stallFee: plan.stallFee, stallFeeBp: plan.stallFeeBp, makerSide: plan.makerSide, state: 'FINAL',
          organic: plan.organic, ...(txHash ? { txHash } : {}), atMs: Date.now(),
        },
      },
    });
  }
}
