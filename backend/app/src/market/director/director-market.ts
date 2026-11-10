import { Inject, Injectable } from '@nestjs/common';
import type { SimCommandV1 } from '@terra/contracts';
import { TradeSimPort } from '../trade/trade-sim.port.js';

export interface DirectorPlace {
  readonly planetId: string;
  readonly command: SimCommandV1;
}

export type DirectorFill =
  | { readonly status: 'filled'; readonly tradeId: string; readonly counterparty: string }
  | { readonly status: 'rejected'; readonly code: string }
  | { readonly status: 'open' };

/** The market door the director loop places through. Tests substitute a fill or a reject. */
export abstract class DirectorMarketPort {
  abstract place(order: DirectorPlace): Promise<DirectorFill>;
}

/**
 * `market.placeOrder` as the colony (`source: 'player'` plus `colonyIndex`).
 * A `bot` source would hit the away gate while the player is away; player orders are exempt.
 */
export function directorPlaceCommand(args: {
  colonyIndex: number;
  commandId: string;
  side: 'sell' | 'buy';
  resource: string;
  amount: number;
  price: { token: string; amount: string };
  ttlS: number;
}): SimCommandV1 {
  return {
    colonyIndex: args.colonyIndex,
    source: 'player',
    commandId: args.commandId,
    kind: 'market.placeOrder',
    args: { side: args.side, resource: args.resource, amount: args.amount, price: args.price, ttlS: args.ttlS },
  };
}

/** Submits the colony order. Accept is not a fill: the loop consumes only when `place` reports `filled`. */
@Injectable()
export class DirectorSimMarket extends DirectorMarketPort {
  constructor(@Inject(TradeSimPort) private readonly sim: TradeSimPort) {
    super();
  }

  async place(order: DirectorPlace): Promise<DirectorFill> {
    try {
      const out = await this.sim.submit(order.planetId, order.command);
      return out.ok ? { status: 'open' } : { status: 'rejected', code: out.code };
    } catch {
      return { status: 'rejected', code: 'host_unavailable' };
    }
  }
}
