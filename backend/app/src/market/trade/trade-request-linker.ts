import { Injectable } from '@nestjs/common';
import type { ActorKind } from '@terra/contracts';
import { TradeRequestRepository } from './trade-request.repository.js';

/** What the sim's `marketOrderRequested` says about an order (the subset the linker matches on). */
export interface RequestedTerms {
  readonly colonyId: string;
  readonly side: string;
  readonly resource: string;
  readonly amount: number;
  readonly price: { readonly amount: string };
  readonly playerId?: string | undefined;
  /** Set by a sim that knows the command's source; used in preference to the request row when present. */
  readonly actorKind?: ActorKind | undefined;
  /** Set by a sim that echoes the command id of the request; the SUBMITTED request with this `commandId` is taken first. */
  readonly commandId?: string | undefined;
}

export interface OrderLink { readonly requestId: string; readonly actorKind: 'player' | 'bot'; readonly ownerId: string }

export interface PlaceOutcome { readonly orderId: string; readonly rejected?: { readonly code: string; readonly detail: string } }

/**
 * Connects the sim's `marketOrderRequested` (which carries no command id) back to the trade API request that caused it,
 * so the order is stored with the right `actorKind` (`bot` for API keys) and owner, and the request learns its outcome.
 * Matching is by colony and exact order terms, oldest first; a colony should therefore not be driven by a key and a
 * game session at the same time with identical orders (see `docs/questions-and-limitations`, trade API).
 * A request that matches nothing (a human placing through the game client) is simply not linked: actor `player`.
 */
@Injectable()
export class TradeRequestLinker {
  constructor(private readonly requests: TradeRequestRepository) {}

  async claim(planetId: string, d: RequestedTerms): Promise<OrderLink | null> {
    const row = await this.requests.claimSubmitted({
      planetId, colonyId: d.colonyId, side: d.side, resource: d.resource, amount: BigInt(d.amount), priceAmount: BigInt(d.price.amount),
      ...(d.commandId ? { commandId: d.commandId } : {}),
    });
    if (!row) return null;
    return { requestId: row.requestId, actorKind: row.keyId ? 'bot' : 'player', ownerId: row.ownerId };
  }

  /** The place handler finished: the order exists (or was rejected under lock). */
  async complete(link: OrderLink, out: PlaceOutcome): Promise<void> {
    if (out.rejected) await this.requests.setState(link.requestId, 'REJECTED', { orderId: out.orderId, errorCode: out.rejected.code, errorDetail: out.rejected.detail });
    else await this.requests.setState(link.requestId, 'ACCEPTED', { orderId: out.orderId });
  }

  async fail(link: OrderLink, reason: string): Promise<void> {
    await this.requests.setState(link.requestId, 'FAILED', { errorCode: 'internal', errorDetail: reason });
  }
}
