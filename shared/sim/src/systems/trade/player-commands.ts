import type { MarketCancelOrderArgs, MarketSetHubFeeArgs } from '@terra/contracts';
import { defineCommandHandler } from '../../kernel/commands';
import { getColonyTradeHubStatus } from '../cargo/trade-hub';
import { colonyIdOf, resolvePlayerColony } from './colony';
import { authorizeMarketActor } from './command-source';
import { ensureColonyMarketState, readMarketPolicy } from './market-state';

export const marketCancelOrderHandler = defineCommandHandler({
  kind: 'market.cancelOrder',
  wave: 'W13',
  handle(state, cmd, ctx) {
    const denied = authorizeMarketActor(cmd, true);
    if (denied) return denied;
    const args = (cmd.args ?? {}) as Partial<MarketCancelOrderArgs>;
    const resolved = resolvePlayerColony(state, cmd, args.colonyId);
    if ('code' in resolved) return resolved;
    const { colony, index } = resolved;
    if (typeof args.orderId !== 'string' || args.orderId.length === 0) return 'invalid_args';

    const market = ensureColonyMarketState(colony, ctx.data);
    const known = args.orderId in market.openOrders || Object.values(market.openOrders).some((o) => o.orderId === args.orderId);
    if (!known) return { code: 'unknown_order', detail: 'No such open order.' };

    const colonyId = colonyIdOf(colony, index);
    const playerId = (colony.playerId as string | undefined) ?? (cmd as { playerId?: string }).playerId;
    ctx.emit({
      kind: 'marketCancelRequested',
      severity: 'info',
      colonyIds: [colonyId],
      data: { colonyId, colonyIndex: index, ...(playerId ? { playerId } : {}), orderId: args.orderId },
    });
    return undefined;
  },
});

export const marketSetHubFeeHandler = defineCommandHandler({
  kind: 'market.setHubFee',
  wave: 'W13',
  handle(state, cmd, ctx) {
    const denied = authorizeMarketActor(cmd, false);
    if (denied) return denied;
    const args = (cmd.args ?? {}) as Partial<MarketSetHubFeeArgs>;
    const resolved = resolvePlayerColony(state, cmd, args.colonyId);
    if ('code' in resolved) return resolved;
    const { colony, index } = resolved;

    const hubs = getColonyTradeHubStatus(state, index, ctx.data, ctx.tick);
    if (hubs.hubCount === 0) return { code: 'no_trade_hub', detail: 'Build a Trade Hub first.' };
    const hub = args.hubId === undefined ? hubs.hubs[0] : hubs.hubs.find((h) => h.entityId === args.hubId);
    if (!hub) return { code: 'invalid_args', detail: 'hubId is not one of your Trade Hubs.' };

    const policy = readMarketPolicy(ctx.data);
    const bp = args.bp;
    if (typeof bp !== 'number' || !Number.isInteger(bp)) return 'invalid_args';
    if (bp < policy.stallFeeMinBp || bp > policy.stallFeeMaxBp) {
      return { code: 'fee_out_of_range', detail: `Stall fee must be within ${policy.stallFeeMinBp}..${policy.stallFeeMaxBp} bp.` };
    }

    const market = ensureColonyMarketState(colony, ctx.data);
    const previousBp = market.hubFeeBp;
    market.hubFeeBp = bp;
    colony.changedAt = ctx.tick;
    const colonyId = colonyIdOf(colony, index);
    ctx.emit({
      kind: 'marketHubFeeSet',
      severity: 'info',
      colonyIds: [colonyId],
      data: { colonyId, colonyIndex: index, hubEntityId: hub.entityId, bp, previousBp },
    });
    return undefined;
  },
});
