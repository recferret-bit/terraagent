import type { KeyRecord } from '../../../trade/trade-key.repository.js';
import { checkAllowance, type ReferencePrice } from '../../../trade/allowance.js';
import type { GuildFundingService, AllowQuoteRequest } from '../../funding/guild-funding.service.js';
import { loadPolicy } from '../../guild-plan.js';
import { barterPairIds } from '../pairs.js';
import type { GuildOrderPort, RestingGuildOrder } from '../order-book.js';
import { cancelIds, type GuildOrderIntent, type MakerNpc } from '../plan.js';

export interface DockReport {
  readonly placed: readonly string[];
  readonly skipped: readonly string[];
}

export interface DockIo {
  port(): GuildOrderPort;
  gate(npc: MakerNpc, key: KeyRecord, intent: GuildOrderIntent, outstanding: number, committed: bigint): Promise<string | null>;
  cancelNpc(npcId: string, planetId?: string): Promise<string[]>;
  funding: GuildFundingService;
  has(wave: string): boolean;
  note(reason: string): string;
}

export function dockReport(placed: readonly string[], skipped: readonly string[]): DockReport {
  return { placed, skipped };
}

/** Rest every new side, skipping a pair side that is already open. A kill cancels what was just placed. */
export async function admitQuotes(
  io: DockIo,
  npc: MakerNpc,
  key: KeyRecord,
  planned: readonly GuildOrderIntent[],
  planetId: string,
): Promise<DockReport> {
  const placed: string[] = [];
  const skipped: string[] = [];
  let open = await io.port().resting(npc.npcId, planetId);
  let committed = open.reduce((sum, row) => sum + row.notional, 0n);
  for (const intent of planned) {
    if (open.some((row) => row.base === intent.base && row.side === intent.side)) {
      skipped.push('duplicate');
      continue;
    }
    const reason = await io.gate(npc, key, intent, open.length, committed);
    if (reason === 'killed') {
      await io.cancelNpc(npc.npcId, planetId);
      return dockReport(placed, [...skipped, 'killed']);
    }
    if (reason) {
      skipped.push(reason);
      continue;
    }
    const row = await placeOrRelease(io, npc.npcId, intent);
    if (!row) {
      skipped.push('duplicate');
      continue;
    }
    placed.push(row);
    committed += intent.priceAmount;
    open = [...open, restingFrom(intent, row)];
  }
  return dockReport(placed, skipped);
}

export async function placeOrRelease(
  io: { port(): GuildOrderPort; funding: GuildFundingService },
  npcId: string,
  intent: GuildOrderIntent,
): Promise<string | null> {
  try {
    const row = await io.port().place(intent);
    if (row.created) return row.orderId;
    await io.funding.release(npcId, intent.bucket, intent.reserve);
    return null;
  } catch (err) {
    await io.funding.release(npcId, intent.bucket, intent.reserve);
    throw err;
  }
}

export async function gateIntent(
  io: Pick<DockIo, 'funding' | 'has' | 'note'>,
  key: KeyRecord,
  npcId: string,
  intent: GuildOrderIntent,
  outstanding: number,
  committed: bigint,
): Promise<string | null> {
  const allowance = allowanceOf(key, intent, outstanding, committed);
  if (allowance) return allowance;
  const preview = await io.funding.allowQuote(quoteRequest(npcId, intent, io.has));
  if (!preview.ok) return io.note(preview.reason);
  const held = await io.funding.reserve(npcId, intent.bucket, intent.reserve);
  return held.ok ? null : io.note(held.reason);
}

export async function cancelResting(io: DockIo, npcId: string, planetId?: string): Promise<string[]> {
  const rows = await io.port().resting(npcId, planetId);
  const ids = cancelIds(rows);
  for (const row of rows) {
    await io.port().cancel(row);
    if (row.reserve > 0n) await io.funding.release(npcId, row.bucket, row.reserve);
  }
  return ids;
}

function allowanceOf(key: KeyRecord, intent: GuildOrderIntent, outstanding: number, committed: bigint): string | null {
  const reference: ReferencePrice | null = intent.reference;
  const rejection = checkAllowance(
    { ...key.allowance, allowedPairs: [...new Set([...key.allowance.allowedPairs, ...barterPairIds()])] },
    { pair: intent.pair, amount: intent.amount, notional: intent.priceAmount },
    { outstandingOrders: outstanding, committedToday: committed, reference },
  );
  return rejection?.code ?? null;
}

function quoteRequest(npcId: string, intent: GuildOrderIntent, has: (wave: string) => boolean): AllowQuoteRequest {
  const policy = loadPolicy(has);
  return {
    npcId,
    side: intent.side,
    quote: 'inventory',
    size: intent.reserve,
    stock: intent.stock,
    cashEnabled: policy.cashEnabled,
    referenceAgeS: 0,
    eligibleVolume: policy.params.minReferenceVolume,
    referenceMaxAgeS: policy.params.referenceMaxAgeS,
    minReferenceVolume: policy.params.minReferenceVolume,
  };
}

function restingFrom(intent: GuildOrderIntent, orderId: string): RestingGuildOrder {
  return {
    orderId,
    planetId: intent.planetId,
    colonyId: intent.npcId,
    base: intent.base,
    quote: intent.quote,
    side: intent.side,
    actorKind: 'npc',
    bucket: intent.bucket,
    reserve: intent.reserve,
    notional: intent.priceAmount,
    amount: intent.amount,
    ref: intent.ref,
    departAt: intent.departAt,
    quoteSeq: intent.quoteSeq,
  };
}
