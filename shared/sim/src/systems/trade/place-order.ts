import { RESOURCE_KEYS, isResourceToken, marketOrderRef, type MarketPlaceOrderArgs, type ResourceKey } from '@terra/contracts';
import { defineCommandHandler, type CommandReject } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import { getColonyTradeHubStatus } from '../cargo/trade-hub';
import { ensureColonyCargoState } from '../cargo/state';
import { colonyIdOf, resolvePlayerColony } from './colony';
import { BOT_SOURCE, authorizeMarketActor } from './command-source';
import { maxBuyerSpend } from './market-fees';
import {
  boundOpenOrders,
  ensureColonyMarketState,
  readMarketPolicy,
  readMinNotionalAtomic,
  type ColonyMarketState,
  type MarketPolicy,
} from './market-state';
import { healLeakedSlots } from './market-lifecycle';


/** Free in-orbit units of `resource`: mirror `inOrbit` minus what open orders already reserve. */
export function freeInOrbit(state: PlanetState, colonyIndex: number, market: ColonyMarketState, resource: ResourceKey): number {
  const colony = state.colonies[colonyIndex]!;
  const inOrbit = ensureColonyCargoState(colony).inOrbit[resource] ?? 0;
  return inOrbit - (market.reservedInOrbit[resource] ?? 0);
}

function validateShape(args: Partial<MarketPlaceOrderArgs>, policy: MarketPolicy): CommandReject | undefined {
  const bad = (detail: string): CommandReject => ({ code: 'invalid_args', detail });
  if (args.side !== 'buy' && args.side !== 'sell') return bad('side must be buy or sell');
  if (typeof args.resource !== 'string' || !(RESOURCE_KEYS as readonly string[]).includes(args.resource)) return bad('unknown resource');
  const amount = args.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount % policy.baseLotUnits !== 0) {
    return bad(`amount must be a positive multiple of the base lot (${policy.baseLotUnits})`);
  }
  const price = args.price;
  if (!price || typeof price.token !== 'string' || typeof price.amount !== 'string' || !/^\d+$/.test(price.amount)) return bad('invalid price');
  if (price.token === args.resource) return bad('base and quote must differ');
  if (typeof args.ttlS !== 'number' || !policy.ttlOptionsS.includes(args.ttlS)) return bad('ttlS is not one of the policy options');
  return undefined;
}

function validateFeeAndSize(
  args: MarketPlaceOrderArgs,
  policy: MarketPolicy,
  minNotional: bigint,
): CommandReject | undefined {
  if (args.maxStallFeeBp !== undefined && !Number.isInteger(args.maxStallFeeBp)) {
    return { code: 'invalid_args', detail: 'maxStallFeeBp must be an integer number of basis points' };
  }
  if (args.maxStallFeeBp !== undefined && (args.maxStallFeeBp <policy.stallFeeMinBp || args.maxStallFeeBp > policy.stallFeeMaxBp)) {
    return { code: 'fee_out_of_range', detail: `maxStallFeeBp must be within ${policy.stallFeeMinBp}..${policy.stallFeeMaxBp}` };
  }
  if (BigInt(args.price.amount) < minNotional) {
    return { code: 'order_too_small', detail: `Total quote is below the minimum notional (${minNotional}).` };
  }
  return undefined;
}

/** Cargo reserve check: a sell needs the base; a barter buy needs the quote resource plus the maximum fees. */
function checkCargo(
  state: PlanetState,
  colonyIndex: number,
  market: ColonyMarketState,
  args: MarketPlaceOrderArgs,
  policy: MarketPolicy,
): CommandReject | undefined {
  const short = (detail: string): CommandReject => ({ code: 'insufficient_cargo', detail });
  if (args.side === 'sell') {
    return freeInOrbit(state, colonyIndex, market, args.resource) < args.amount ? short('Not enough free cargo in orbit.') : undefined;
  }
  if (!isResourceToken(args.price.token)) return undefined; // USDC / NEAR funds are checked by the server
  const price = BigInt(args.price.amount);
  const maxStall = args.maxStallFeeBp ?? policy.stallFeeMaxBp;
  // Same reservation as the server and the harness (floor fees, `maxBuyerSpend`): the sim never rejects what the book accepts.
  const need = maxBuyerSpend(price, policy.platformFeeBp, maxStall);
  const free = BigInt(freeInOrbit(state, colonyIndex, market, args.price.token));
  return free < need ? short(`Not enough free ${args.price.token} in orbit (need ${need} incl. fees).`) : undefined;
}

export const marketPlaceOrderHandler = defineCommandHandler({
  kind: 'market.placeOrder',
  wave: 'W13',
  handle(state, cmd, ctx) {
    const denied = authorizeMarketActor(cmd, true);
    if (denied) return denied;
    const args = (cmd.args ?? {}) as Partial<MarketPlaceOrderArgs>;
    const resolved = resolvePlayerColony(state, cmd, args.colonyId);
    if ('code' in resolved) return resolved;
    const { colony, index } = resolved;

    const policy = readMarketPolicy(ctx.data);
    const shape = validateShape(args, policy);
    if (shape) return shape;
    const order = args as MarketPlaceOrderArgs;

    const hubs = getColonyTradeHubStatus(state, index, ctx.data, ctx.tick);
    if (hubs.hubCount === 0) return { code: 'no_trade_hub', detail: 'Build a Trade Hub to trade.' };
    const online = hubs.hubs.filter((h) => h.online);
    if (online.length === 0) return { code: 'hub_offline', detail: 'Trade Hub is unpowered.' };
    const hub = args.stallId === undefined ? online[0] : online.find((h) => h.entityId === Number(args.stallId));
    if (!hub) return { code: 'invalid_args', detail: 'stallId is not one of your online Trade Hubs.' };

    const rejected = validateFeeAndSize(order, policy, readMinNotionalAtomic(ctx.data, order.price.token));
    if (rejected) return rejected;

    const market = ensureColonyMarketState(colony, ctx.data);
    if (Object.keys(market.openOrders).length >= policy.openOrderLimit) healLeakedSlots(market, policy);
    if (Object.keys(market.openOrders).length >= policy.openOrderLimit) {
      return { code: 'order_limit', detail: `At most ${policy.openOrderLimit} open orders.` };
    }
    const cargo = checkCargo(state, index, market, order, policy);
    if (cargo) return cargo;

    market.orderSeq += 1;
    colony.changedAt = ctx.tick;
    const colonyId = colonyIdOf(colony, index);
    market.requested[marketOrderRef(colonyId, market.orderSeq)] = { side: order.side, resource: order.resource, amount: order.amount };
    boundOpenOrders(market, policy);
    const playerId = (colony.playerId as string | undefined) ?? (cmd as { playerId?: string }).playerId;
    ctx.emit({
      kind: 'marketOrderRequested',
      severity: 'info',
      colonyIds: [colonyId],
      data: {
        ref: marketOrderRef(colonyId, market.orderSeq),
        orderSeq: market.orderSeq,
        colonyId,
        colonyIndex: index,
        ...(playerId ? { playerId } : {}),
        side: order.side,
        resource: order.resource,
        amount: order.amount,
        price: { token: order.price.token, amount: order.price.amount },
        ttlS: order.ttlS,
        stallFeeBp: market.hubFeeBp,
        ...(order.maxStallFeeBp !== undefined ? { maxStallFeeBp: order.maxStallFeeBp } : {}),
        hubEntityId: hub.entityId,
        ...(colony.name ? { stallName: String(colony.name).slice(0, 64) } : {}),
        ...(typeof cmd.commandId === 'string' && cmd.commandId ? { commandId: cmd.commandId } : {}),
        actorKind: (cmd.source as string) === BOT_SOURCE ? 'bot' : 'player',
        ...(order.director === true ? { director: true } : {}),
      },
    });
    return undefined;
  },
});
