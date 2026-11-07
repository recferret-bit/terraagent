import type { MarketTokenKey, ProgressEventV1 } from '@terra/contracts';
import { merchantEvent, portAuthorityEvent, type MarketProgressSource } from './market-progress-events.js';

/** The slice of `PrismaClient` the replay reads (a structural type, so unit specs can hand in a fake). */
export interface ReplayDb {
  intentTrade: {
    findMany(args: Record<string, unknown>): Promise<ReplayTradeRow[]>;
  };
  progressionReceipt: { findMany(args: Record<string, unknown>): Promise<{ id: string }[]> };
  colony: { findMany(args: Record<string, unknown>): Promise<{ id: string; playerId: string }[]> };
}

export interface ReplayTradeRow {
  id: bigint;
  tradeId: string;
  planetId: string;
  quote: string;
  buyerColonyId: string;
  sellerColonyId: string;
  stallColonyId: string;
  stallFee: { toFixed(digits: number): string } | string | bigint;
}

export interface FactReplayOptions {
  /** Trades younger than this are left to the live path (default 60 s), so the live event's `atTick` wins. */
  readonly graceMs?: number;
  /** Only trades settled within this window are scanned (default 7 days). */
  readonly lookbackMs?: number;
  readonly pageSize?: number;
}

export interface FactReplayResult { readonly scanned: number; readonly replayed: number; readonly skipped: number; readonly failed: number }

const eventIds = (t: ReplayTradeRow): string[] => [
  `market:merchant:${t.tradeId}:${t.buyerColonyId}`,
  `market:merchant:${t.tradeId}:${t.sellerColonyId}`,
  `market:portAuthority:${t.tradeId}:${t.stallColonyId}`,
];

const atomsOf = (v: ReplayTradeRow['stallFee']): string => (typeof v === 'string' ? v : typeof v === 'bigint' ? v.toString() : v.toFixed(0));

/**
 * Durable outbox for the W13-27 progression facts (LED-25). The live path (`MarketProgressionProducer`) turns the sim's
 * `tradeSettled` / `feeEarned` into facts, which a crash between `FINAL` and that write loses. `chain.intent_trade` is the
 * durable source of truth, so this pass re-derives the events of every FINAL trade and applies those whose
 * `core.progression_receipt` (`market:<kind>:<tradeId>:<colonyId>`) is missing. Idempotent: a trade that already has all
 * its receipts is skipped, and the engine itself keeps one receipt per event id.
 * Limits: the replayed event has `atTick` 0 (the tick is not stored); a colony without a `core.colony` row (seed bots)
 * produces no fact, same as the live path.
 */
export class MarketFactReplay {
  constructor(
    private readonly db: ReplayDb,
    private readonly apply: (event: ProgressEventV1) => Promise<unknown>,
    private readonly opts: FactReplayOptions = {},
  ) {}

  async runOnce(now = Date.now()): Promise<FactReplayResult> {
    const grace = this.opts.graceMs ?? 60_000;
    const lookback = this.opts.lookbackMs ?? 7 * 86_400_000;
    const take = this.opts.pageSize ?? 200;
    const total = { scanned: 0, replayed: 0, skipped: 0, failed: 0 };
    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.db.intentTrade.findMany({
        where: { state: 'FINAL', settledAt: { gte: new Date(now - lookback), lte: new Date(now - grace) }, ...(cursor === undefined ? {} : { id: { gt: cursor } }) },
        orderBy: { id: 'asc' },
        take,
      });
      if (rows.length === 0) return total;
      cursor = rows[rows.length - 1]!.id;
      const part = await this.replayPage(rows);
      total.scanned += rows.length;
      total.replayed += part.replayed;
      total.skipped += part.skipped;
      total.failed += part.failed;
      if (rows.length < take) return total;
    }
  }

  private async replayPage(rows: readonly ReplayTradeRow[]): Promise<{ replayed: number; skipped: number; failed: number }> {
    const have = new Set((await this.db.progressionReceipt.findMany({ where: { id: { in: rows.flatMap(eventIds) } }, select: { id: true } })).map((r) => r.id));
    const open = rows.filter((t) => eventIds(t).some((id) => !have.has(id)));
    const players = await this.players(open);
    let replayed = 0, failed = 0;
    for (const t of open) {
      for (const ev of this.eventsOf(t, players)) {
        if (have.has(ev.eventId!)) continue;
        try { await this.apply(ev); replayed++; } catch { failed++; }
      }
    }
    return { replayed, skipped: rows.length - open.length, failed };
  }

  private async players(rows: readonly ReplayTradeRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((t) => [t.buyerColonyId, t.sellerColonyId, t.stallColonyId]))];
    if (ids.length === 0) return new Map();
    return new Map((await this.db.colony.findMany({ where: { id: { in: ids } }, select: { id: true, playerId: true } })).map((c) => [c.id, c.playerId]));
  }

  private eventsOf(t: ReplayTradeRow, players: ReadonlyMap<string, string>): ProgressEventV1[] {
    const src = (colonyId: string): MarketProgressSource | null => {
      const playerId = players.get(colonyId);
      return playerId ? { planetId: t.planetId, colonyId, playerId, tradeId: t.tradeId } : null;
    };
    const out: ProgressEventV1[] = [];
    for (const colonyId of new Set([t.buyerColonyId, t.sellerColonyId])) {
      const s = src(colonyId);
      if (s) out.push(merchantEvent(s));
    }
    const stall = src(t.stallColonyId);
    if (stall) {
      let fee: ProgressEventV1 | null = null;
      try { fee = portAuthorityEvent(stall, t.quote as MarketTokenKey, atomsOf(t.stallFee)); } catch { /* unknown token: no fact */ }
      if (fee) out.push(fee);
    }
    return out;
  }
}
