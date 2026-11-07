import type { MarketReleaseArgs, ResourceKey, MarketReserveArgs, MarketSettledArgs } from '@terra/contracts';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { ensureColonyCargoState } from '../cargo/state';
import { colonyIdOf, resolveModuleColonyIndex } from './colony';
import { isModuleSource } from './command-source';
import {
  MAX_TRACKED_SETTLED_TRADES,
  addAmounts,
  boundOpenOrders,
  ensureColonyMarketState,
  readMarketPolicy,
  sumAmounts,
  type ColonyMarketState,
  type ColonyOpenOrder,
  type MarketResourceAmounts,
} from './market-state';

type Resolved = { colony: ColonyState; index: number; market: ColonyMarketState };

/** Module-only commands: a player command is `not_authorized`; the colony resolves like `cargo.settled`. */
function resolveModule(
  state: PlanetState,
  cmd: SimCommand,
  args: { colonyId?: string; colonyIndex?: number },
  ctx: StepContext,
): Resolved | string {
  if (!isModuleSource(cmd)) return 'not_authorized';
  const index = resolveModuleColonyIndex(state, cmd, args);
  const colony = index >= 0 ? state.colonies[index] : undefined;
  if (!colony) return 'not_own_colony';
  return { colony, index, market: ensureColonyMarketState(colony, ctx.data) };
}

export const marketReserveHandler = defineCommandHandler({
  kind: 'market.reserve',
  wave: 'W13',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Partial<MarketReserveArgs>;
    if (typeof args.ref !== 'string' || args.ref.length === 0 || !args.deltas) return isModuleSource(cmd) ? 'invalid_args' : 'not_authorized';
    const r = resolveModule(state, cmd, args, ctx);
    if (typeof r === 'string') return r;
    const { colony, market } = r;

    const prev = market.openOrders[args.ref];
    if (prev) addAmounts(market.reservedInOrbit, prev.reserved, -1); // re-reserve replaces, never double counts
    const reserved: MarketResourceAmounts = {};
    addAmounts(reserved, args.deltas, 1);
    const requested = prev ?? market.requested[args.ref];
    const open: ColonyOpenOrder = {
      side: requested?.side ?? 'sell',
      resource: requested?.resource ?? (Object.keys(reserved)[0] as ResourceKey),
      amount: requested?.amount ?? 0,
      reserved,
    };
    if (args.orderId ?? prev?.orderId) open.orderId = args.orderId ?? prev?.orderId;
    delete market.requested[args.ref];
    market.openOrders[args.ref] = open;
    addAmounts(market.reservedInOrbit, reserved, 1);
    boundOpenOrders(market, readMarketPolicy(ctx.data));
    colony.changedAt = ctx.tick;
    return undefined;
  },
});

export const marketReleaseHandler = defineCommandHandler({
  kind: 'market.release',
  wave: 'W13',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Partial<MarketReleaseArgs>;
    if (typeof args.ref !== 'string' || args.ref.length === 0 || !args.deltas || !args.reason) return isModuleSource(cmd) ? 'invalid_args' : 'not_authorized';
    const r = resolveModule(state, cmd, args, ctx);
    if (typeof r === 'string') return r;
    const { colony, index, market } = r;

    addAmounts(market.reservedInOrbit, args.deltas, -1);
    if (args.reason !== 'filled') delete market.requested[args.ref];
    const order = market.openOrders[args.ref];
    if (order) {
      addAmounts(order.reserved, args.deltas, -1);
      if (args.reason !== 'filled' || sumAmounts(order.reserved) === 0) delete market.openOrders[args.ref];
    }
    colony.changedAt = ctx.tick;
    if (args.reason === 'settlement_failed') {
      const colonyId = colonyIdOf(colony, index);
      ctx.emit({ kind: 'marketSettlementFailed', severity: 'warn', colonyIds: [colonyId], data: { colonyId, colonyIndex: index, ref: args.ref } });
    }
    if (args.reason === 'rejected') {
      const colonyId = colonyIdOf(colony, index);
      ctx.emit({
        kind: 'marketOrderRejected',
        severity: 'warn',
        colonyIds: [colonyId],
        data: {
          colonyId,
          colonyIndex: index,
          ref: args.ref,
          code: args.code ?? 'invalid_args',
          ...(args.detail ? { detail: args.detail } : {}),
        },
      });
    }
    return undefined;
  },
});

function emitSettled(colony: ColonyState, index: number, args: MarketSettledArgs, ctx: StepContext): void {
  const colonyId = colonyIdOf(colony, index);
  const t = args.trade;
  if (args.role === 'stall') {
    ctx.emit({
      kind: 'feeEarned',
      severity: 'info',
      colonyIds: [colonyId],
      data: { tradeId: args.tradeId, colonyId, colonyIndex: index, token: t.quote, amount: t.stallFee, bp: t.stallFeeBp },
    });
    return;
  }
  ctx.emit({
    kind: 'tradeSettled',
    severity: 'info',
    colonyIds: [colonyId],
    data: {
      tradeId: args.tradeId, colonyId, colonyIndex: index, role: args.role,
      ...(args.ref ? { ref: args.ref } : {}),
      base: t.base, amount: t.amount, quote: t.quote, notional: t.notional, platformFee: t.platformFee,
      stallFee: t.stallFee, stallFeeBp: t.stallFeeBp, makerSide: t.makerSide,
      ...(t.stallName ? { stallName: t.stallName } : {}),
      ...(t.txHash ? { txHash: t.txHash } : {}),
    },
  });
}

export const marketSettledHandler = defineCommandHandler({
  kind: 'market.settled',
  wave: 'W13',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Partial<MarketSettledArgs>;
    const valid = typeof args.tradeId === 'string' && args.tradeId.length > 0 && !!args.deltas && !!args.trade &&
      (args.role === 'buyer' || args.role === 'seller' || args.role === 'stall');
    if (!valid) return isModuleSource(cmd) ? 'invalid_args' : 'not_authorized';
    const full = args as MarketSettledArgs;
    const r = resolveModule(state, cmd, full, ctx);
    if (typeof r === 'string') return r;
    const { colony, index, market } = r;

    const key = `${full.tradeId}:${full.role}`;
    if (market.settledTrades.includes(key)) return undefined; // replayed: already applied
    market.settledTrades.push(key);
    while (market.settledTrades.length > MAX_TRACKED_SETTLED_TRADES) market.settledTrades.shift();

    addAmounts(ensureColonyCargoState(colony).inOrbit, full.deltas, 1);
    if (full.released) {
      addAmounts(market.reservedInOrbit, full.released, -1);
      const order = full.ref ? market.openOrders[full.ref] : undefined;
      if (order) {
        const before = sumAmounts(order.reserved);
        addAmounts(order.reserved, full.released, -1);
        if (before > 0 && sumAmounts(order.reserved) === 0) delete market.openOrders[full.ref!];
      }
    }
    market.lastTrade = { tradeId: full.tradeId, role: full.role, base: full.trade.base, amount: full.trade.amount, quote: full.trade.quote, atTick: ctx.tick };
    colony.changedAt = ctx.tick;
    emitSettled(colony, index, full, ctx);
    return undefined;
  },
});
