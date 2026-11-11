import type { TradeOverviewResponse } from '@terra/contracts';
import type { DbClient, PrismaClient } from '@terra/db';
import type { CompiledDataLike } from '@terra/sim';
import { decimalToBigint } from '../../../book/decimal.js';
import type { TradeKeyRepository } from '../../../trade/trade-key.repository.js';
import type { GuildFundingService } from '../../funding/guild-funding.service.js';
import { loadPolicy } from '../../guild-plan.js';
import { GuildNpcRepository } from '../../guild-npc.repository.js';
import type { CargoFillResult, GuildCargoFill } from '../../inventory.js';
import type { GuildOrderPort, RestingGuildOrder } from '../order-book.js';
import { planQuotes, type MakerNpc } from '../plan.js';
import { consumedHold, lossBlocksBid, termsMeta, withQuoteSeq, type GuildFillNotice, type OrderMeta, type RequoteReport } from '../requote.js';
import { gateIntent, placeOrRelease } from './dock-pass.js';

export interface RequoteIo {
  prisma?: PrismaClient;
  npcs: GuildNpcRepository;
  keys: TradeKeyRepository;
  funding: GuildFundingService;
  port(): GuildOrderPort;
  data(): CompiledDataLike;
  has(wave: string): boolean;
  note(reason: string): string;
  overview(planetId: string): Promise<TradeOverviewResponse>;
  quoteTargets(npcId: string): Promise<ReadonlyMap<string, bigint> | undefined>;
  writeFill(npcId: string, fill: GuildCargoFill, db: DbClient): Promise<CargoFillResult | null>;
  npcOf(npcId: string): Promise<MakerNpc | null>;
}

/** Inventory, funding hold, cancel, and the next quote for one fill. Prices stay in `planQuotes` / `quoteGuild`. */
export async function runRequote(io: RequoteIo, notice: GuildFillNotice): Promise<RequoteReport> {
  const meta = await metaOf(io, notice);
  const wrote = await io.npcs.withLock(notice.npcId, (db) => io.writeFill(notice.npcId, cargoOf(notice), db));
  if (!wrote?.ok) return { requoted: false, reason: wrote ? wrote.reason : 'no_npc', previousOrderId: notice.orderId };
  await settleHold(io, notice, meta);
  return placeNext(io, notice, meta);
}

async function metaOf(io: RequoteIo, notice: GuildFillNotice): Promise<OrderMeta> {
  const open = await openQuote(io, notice);
  const stored = await storedMeta(io, notice.orderId);
  return {
    reserve: open?.reserve ?? stored?.reserve ?? notice.reserve,
    departAt: open?.departAt || stored?.departAt || notice.departAt,
    quoteSeq: open?.quoteSeq ?? stored?.quoteSeq ?? notice.quoteSeq,
    orderAmount: open && open.amount > 0n ? open.amount : (stored?.orderAmount ?? notice.orderAmount),
    bucket: open?.bucket ?? stored?.bucket ?? 'inventory',
  };
}

async function storedMeta(io: RequoteIo, orderId: string): Promise<OrderMeta | null> {
  if (!io.prisma) return null;
  const row = await io.prisma.marketOrder.findUnique({
    where: { orderId },
    select: { signedTerms: true, ref: true, amount: true },
  });
  return row ? termsMeta(row.signedTerms, row.ref, decimalToBigint(row.amount)) : null;
}

async function settleHold(io: RequoteIo, notice: GuildFillNotice, meta: OrderMeta): Promise<void> {
  const qty = BigInt(notice.amount);
  const size = meta.orderAmount > 0n ? meta.orderAmount : qty;
  const held = consumedHold(meta.reserve, size, qty);
  if (held > 0n) await io.funding.consume(notice.npcId, meta.bucket, held);
  const open = await openQuote(io, notice);
  if (!open) return;
  const left = meta.reserve > held ? meta.reserve - held : 0n;
  if (left > 0n) await io.funding.release(notice.npcId, open.bucket, left);
  await io.port().cancel(open);
}

async function placeNext(io: RequoteIo, notice: GuildFillNotice, meta: OrderMeta): Promise<RequoteReport> {
  const npc = await io.npcOf(notice.npcId);
  const previousOrderId = notice.orderId;
  if (!npc) return { requoted: false, reason: 'no_npc', previousOrderId };
  const quoteSeq = meta.quoteSeq + 1;
  if (notice.side === 'buy' && lossBlocksBid(npc.lossAtomic, loadPolicy(io.has).dailyLossAtomic)) {
    return { requoted: false, reason: 'loss', quoteSeq, previousOrderId };
  }
  const key = await io.keys.find(npc.tradeKeyId);
  if (!key || key.revokedAt) return { requoted: false, reason: 'no_key', previousOrderId };
  const overview = await io.overview(notice.planetId);
  const dock = { planetId: notice.planetId, departAt: meta.departAt || notice.departAt };
  const intent = planQuotes(io.data(), npc, dock, overview.overview, await io.quoteTargets(npc.npcId)).find(
    (row) => row.base === notice.base && row.quote === notice.quote && row.side === notice.side,
  );
  if (!intent) return { requoted: false, reason: 'paused', previousOrderId };
  const stamped = withQuoteSeq(intent, quoteSeq);
  const open = await io.port().resting(npc.npcId, notice.planetId);
  const committed = open.reduce((sum, row) => sum + row.notional, 0n);
  const reason = await gateIntent(io, key, npc.npcId, stamped, open.length, committed);
  if (reason) return { requoted: false, reason, previousOrderId };
  const orderId = await placeOrRelease(io, npc.npcId, stamped);
  if (!orderId) return { requoted: false, reason: 'duplicate', previousOrderId };
  return { requoted: true, orderId, quoteSeq, bid: stamped.priceAmount, previousOrderId };
}

async function openQuote(io: RequoteIo, notice: GuildFillNotice): Promise<RestingGuildOrder | null> {
  const rows = await io.port().resting(notice.npcId, notice.planetId);
  return rows.find((row) => row.orderId === notice.orderId) ?? rows.find((row) => row.base === notice.base && row.side === notice.side) ?? null;
}

function cargoOf(notice: GuildFillNotice): GuildCargoFill {
  return { resource: notice.base, side: notice.side, amount: notice.amount, planetId: notice.planetId };
}
