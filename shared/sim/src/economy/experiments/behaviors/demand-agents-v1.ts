import type { ResourceKey } from '@terra/contracts';
import { agentParamsFromData } from '../../../systems/trade/agent';
import { ensureColonyCargoState } from '../../../systems/cargo/state';
import { ensureColonyMarketState } from '../../../systems/trade/market-state';
import { freeInOrbit } from '../../../systems/trade/place-order';
import type { BehaviorContext, BehaviorProfile } from '../types';
import { actAgent, defaultBoardLimits, demandAgentParams, OrderLog, type AgentWorld, type DemandAgentParams, type DemandCounters } from './demand-agents-core';

/**
 * Scripted behaviour `demand-agents-v1` (ECONOMY section 4/6): the demand-based successor of `specialists-v1`. Each colony
 * quotes from its own need, inventory scarcity and the OBSERVED board reference through the shared quote library; the only
 * typed-in price is the labelled bootstrap SUBSIDY of `demand-agents-core.ts`. Cargo logistics (export surplus stock to
 * orbit, import what was bought) are the same unit commands the specialists use. Orders go in as `source: 'bot'` (a bot-operated
 * colony naming its `colonyIndex`), the path the backend bot API takes. Per-run counters (`subsidyQuotes`, paused-bid
 * reasons) are kept in `stats.rejected` under `demand:*` keys.
 */
function worldOf(ctx: BehaviorContext, ttlS: number): AgentWorld {
  const state = ctx.host.state;
  const stock = (ci: number, r: ResourceKey): bigint => BigInt((state.colonies[ci]!.stock as Record<string, number>)[r] ?? 0);
  const orbit = (ci: number, r: ResourceKey): bigint => BigInt(ensureColonyCargoState(state.colonies[ci]!).inOrbit[r] ?? 0);
  return {
    tick: ctx.host.tick,
    ticksPerSecond: ctx.manifest.ticksPerSecond,
    inventory: (ci, r) => stock(ci, r) + orbit(ci, r),
    freeUnits: (ci, r) => BigInt(Math.max(0, freeInOrbit(state, ci, ensureColonyMarketState(state.colonies[ci]!), r))),
    freeQuote: (ci) => ctx.harness.freeQuote(state.colonies[ci]!.id, 'USDC'),
    hasOpen(ci, r, side) {
      const col = state.colonies[ci]!;
      return ctx.harness.openOrders(col.id).some((o) => o.base === r && o.side === side) ||
        Object.values(ensureColonyMarketState(col).requested).some((q) => q.resource === r && q.side === side);
    },
    colonyId: (ci) => state.colonies[ci]!.id,
    trades: () => ctx.harness.trades,
    place(ci, side, resource, amount, priceTotal) {
      ctx.host.submit({
        colonyIndex: ci, source: 'bot' as 'player', commandId: ctx.nextCommandId(), kind: 'market.placeOrder',
        args: { colonyId: state.colonies[ci]!.id, side, resource, amount: Number(amount), price: { token: 'USDC', amount: priceTotal.toString() }, ttlS },
      });
      ctx.stats.ordersRequested++;
    },
  };
}

function logistics(ctx: BehaviorContext, p: DemandAgentParams, ci: number, resource: ResourceKey): void {
  const state = ctx.host.state;
  const col = state.colonies[ci]!;
  const stock = (col.stock as Record<string, number>)[resource] ?? 0;
  const cargo = col.cargo as { pendingMint?: Record<string, { resource: string }> } | undefined;
  const orbit = ensureColonyCargoState(col).inOrbit[resource] ?? 0;
  const market = ensureColonyMarketState(col);
  const sellOpen = ctx.harness.openOrders(col.id).some((o) => o.base === resource && o.side === 'sell') ||
    Object.values(market.requested).some((q) => q.resource === resource && q.side === 'sell');
  if (stock >= p.keepUnits + p.exportLot && orbit < p.exportLot && !Object.values(cargo?.pendingMint ?? {}).some((m) => m.resource === resource)) {
    ctx.host.submit({ colonyIndex: ci, source: 'player', commandId: ctx.nextCommandId(), kind: 'cargo.export', args: { colonyId: col.id, resource, amount: p.exportLot } });
    ctx.stats.exports++;
  }
  if (stock < p.targetUnits && orbit > 0 && !sellOpen) {
    ctx.host.submit({ colonyIndex: ci, source: 'player', commandId: ctx.nextCommandId(), kind: 'cargo.import', args: { colonyId: col.id, resource, amount: orbit } });
    ctx.stats.imports++;
  }
}

export const demandAgentsV1 = (overrides?: Readonly<Record<string, unknown>>): BehaviorProfile => {
  const p = demandAgentParams(overrides);
  const log = new OrderLog();
  const counters: DemandCounters = { quotes: 0, subsidyQuotes: 0, pausedBids: 0, reasons: {} };
  const limits = defaultBoardLimits();
  return {
    id: 'demand-agents-v1',
    actEveryTicks: p.actEveryTicks,
    act(ctx) {
      const world = worldOf(ctx, p.ttlS);
      const params = agentParamsFromData(ctx.host.pipeline.config.data);
      const cfg = ctx.harness.config;
      const board = p.boardMinCounterparties === null ? limits : { ...limits, minCounterparties: p.boardMinCounterparties };
      for (const col of ctx.host.state.colonies) {
        if (!col || col.status === 'eliminated') continue;
        for (const resource of ctx.resources) {
          logistics(ctx, p, col.index, resource);
          actAgent(world, log, col.index, resource, p, params, { platformFeeBp: cfg.platformFeeBp, stallFeeMaxBp: cfg.stallFeeMaxBp }, board, counters);
        }
      }
      ctx.stats.notes = { quotes: counters.quotes, subsidyQuotes: counters.subsidyQuotes, pausedBids: counters.pausedBids, ...counters.reasons };
    },
  };
};
