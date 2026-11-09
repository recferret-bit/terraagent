import { nextU32 } from '../../../kernel/rng';
import { freeInOrbit } from '../../../systems/trade/place-order';
import { ensureColonyMarketState } from '../../../systems/trade/market-state';
import type { ResourceKey } from '@terra/contracts';
import type { BehaviorContext, BehaviorProfile } from '../types';

/**
 * Scripted behaviour `specialists-v1` (ECONOMY §6): a colony holding more than `exportAbove` of a resource exports a lot
 * to orbit and offers it for USDC; a colony below `buyBelow` bids for a lot (funded by the mock USDC budget) and imports
 * what it bought. Every number is experiment configuration (`SPECIALISTS_V1_PARAMS`), overridable per scenario through
 * `assumptions.behavior`; none is a game rule. The random source is the run's own stream.
 */
export interface SpecialistsParams {
  readonly exportAbove: number;
  readonly keepUnits: number;
  readonly exportLot: number;
  readonly buyBelow: number;
  readonly buyLot: number;
  /** USDC atomic units per resource unit the specialists treat as fair (assumed, not observed). */
  readonly referencePriceAtomic: string;
  readonly askSpreadBp: number;
  readonly bidSpreadBp: number;
  readonly jitterBp: number;
  readonly ttlS: number;
  readonly actEveryTicks: number;
}

export const SPECIALISTS_V1_PARAMS: SpecialistsParams = {
  exportAbove: 260,
  keepUnits: 200,
  exportLot: 20,
  buyBelow: 250,
  buyLot: 20,
  referencePriceAtomic: '250000',
  askSpreadBp: 500,
  bidSpreadBp: 1500,
  jitterBp: 300,
  ttlS: 900,
  actEveryTicks: 50,
};

export function specialistsParams(overrides: Readonly<Record<string, unknown>> | undefined): SpecialistsParams {
  const merged: Record<string, unknown> = { ...SPECIALISTS_V1_PARAMS };
  for (const [k, v] of Object.entries(overrides ?? {})) if (k in SPECIALISTS_V1_PARAMS && typeof v === typeof (SPECIALISTS_V1_PARAMS as unknown as Record<string, unknown>)[k]) merged[k] = v;
  return merged as unknown as SpecialistsParams;
}

const draw = (ctx: BehaviorContext, jitterBp: number): bigint => BigInt((nextU32(ctx.rng) % (2 * jitterBp + 1)) - jitterBp);

function priceFor(ctx: BehaviorContext, p: SpecialistsParams, side: 'buy' | 'sell', amount: number): string {
  const spread = BigInt(side === 'sell' ? p.askSpreadBp : p.bidSpreadBp) + draw(ctx, p.jitterBp);
  return ((BigInt(amount) * BigInt(p.referencePriceAtomic) * (10_000n + spread)) / 10_000n).toString();
}

function place(ctx: BehaviorContext, p: SpecialistsParams, ci: number, colonyId: string, side: 'buy' | 'sell', resource: ResourceKey, amount: number): void {
  ctx.host.submit({
    colonyIndex: ci, source: 'player', commandId: ctx.nextCommandId(), kind: 'market.placeOrder',
    args: { colonyId, side, resource, amount, price: { token: 'USDC', amount: priceFor(ctx, p, side, amount) }, ttlS: p.ttlS },
  });
  ctx.stats.ordersRequested++;
}

function actColonyResource(ctx: BehaviorContext, p: SpecialistsParams, ci: number, resource: ResourceKey): void {
  const state = ctx.host.state;
  const col = state.colonies[ci]!;
  const stock = (col.stock as Record<string, number>)[resource] ?? 0;
  const market = ensureColonyMarketState(col);
  const cargo = col.cargo as { pendingMint?: Record<string, { resource: string }> } | undefined;
  const orbit = freeInOrbit(state, ci, market, resource);
  const open = (side: 'buy' | 'sell'): boolean =>
    ctx.harness.openOrders(col.id).some((o) => o.base === resource && o.side === side) ||
    Object.values(market.requested).some((r) => r.resource === resource && r.side === side);
  if (stock >= p.exportAbove && !Object.values(cargo?.pendingMint ?? {}).some((m) => m.resource === resource)) {
    ctx.host.submit({ colonyIndex: ci, source: 'player', commandId: ctx.nextCommandId(), kind: 'cargo.export', args: { colonyId: col.id, resource, amount: Math.min(p.exportLot, stock - p.keepUnits) } });
    ctx.stats.exports++;
  }
  if (orbit >= p.exportLot && stock >= p.keepUnits && !open('sell')) place(ctx, p, ci, col.id, 'sell', resource, Math.min(orbit, p.exportLot));
  if (stock < p.buyBelow) {
    if (orbit > 0 && !open('sell')) {
      ctx.host.submit({ colonyIndex: ci, source: 'player', commandId: ctx.nextCommandId(), kind: 'cargo.import', args: { colonyId: col.id, resource, amount: orbit } });
      ctx.stats.imports++;
    } else if (!open('buy') && ctx.harness.freeQuote(col.id, 'USDC') >= BigInt(p.referencePriceAtomic) * BigInt(p.buyLot) * 2n) place(ctx, p, ci, col.id, 'buy', resource, p.buyLot);
  }
}

export const specialistsV1 = (overrides?: Readonly<Record<string, unknown>>): BehaviorProfile => {
  const p = specialistsParams(overrides);
  return {
    id: 'specialists-v1',
    actEveryTicks: p.actEveryTicks,
    act(ctx) {
      for (const col of ctx.host.state.colonies) {
        if (!col || col.status === 'eliminated') continue;
        for (const resource of ctx.resources) actColonyResource(ctx, p, col.index, resource);
      }
    },
  };
};
