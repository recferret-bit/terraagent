import { Injectable } from '@nestjs/common';
import { MARKET_TOKENS, isResourceToken, type MarketTokenKey, type OrderSide, type QuoteToken, type ResourceKey } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import { CargoTokenPort, CARGO_BASE_UNIT } from '../../near/application/ports/cargo-token.port.js';
import { IntentsBalanceReadPort } from '../../near/application/ports/intents-balance-read.port.js';
import { MarketOrderRepository } from '../book/market-order.repository.js';
import { maxBuyerSpend } from './max-buyer-spend.js';

export interface OrderTerms {
  readonly side: OrderSide;
  readonly base: ResourceKey;
  readonly quote: QuoteToken;
  readonly amount: bigint;
  readonly priceAmount: bigint;
  readonly platformFeeBp: number;
  readonly maxStallFeeBp: number;
}

/** What an order locks: `principal` + `fees` of one token (sell: base units; buy: quote atomic incl. both fees). */
export interface Requirement {
  readonly token: MarketTokenKey;
  readonly principal: bigint;
  readonly fees: bigint;
}

export function requirementOf(t: OrderTerms): Requirement {
  if (t.side === 'sell') return { token: t.base, principal: t.amount, fees: 0n };
  return { token: t.quote, principal: t.priceAmount, fees: maxBuyerSpend(t.priceAmount, t.platformFeeBp, t.maxStallFeeBp) - t.priceAmount };
}

export interface FundsView {
  /** Whole units the colony account holds in the cargo ledger (resources only). */
  readonly cargo: bigint;
  /** Market atomic units held at the verifier. */
  readonly verifier: bigint;
  /** Locked by the colony's open orders (DB reservations). */
  readonly reserved: bigint;
  readonly free: bigint;
}

/** Read side of "what can this colony still lock": cargo account + verifier balance - open-order reservations. */
@Injectable()
export class OrderFunds {
  constructor(
    private readonly repo: MarketOrderRepository,
    private readonly cargo: CargoTokenPort,
    private readonly verifier: IntentsBalanceReadPort,
  ) {}

  /** Sum of reservations of `token` over the colony's OPEN/PARTIAL orders, optionally read inside `tx`. */
  async reservedBy(colonyId: string, token: MarketTokenKey, tx?: DbClient): Promise<bigint> {
    let sum = 0n;
    for (const o of await this.repo.listOpenByColony(colonyId, tx)) {
      const locks = o.side === 'sell' ? o.base : o.quote;
      if (locks === token) sum += o.reservedPrincipal + o.reservedFees;
    }
    return sum;
  }

  async view(accountId: string, colonyId: string, token: MarketTokenKey, tx?: DbClient): Promise<FundsView> {
    const cargo = isResourceToken(token) ? BigInt(await this.cargo.balanceOf({ accountId, tokenId: token })) / CARGO_BASE_UNIT : 0n;
    const verifier = await this.verifier.verifierBalance(accountId, token);
    const reserved = await this.reservedBy(colonyId, token, tx);
    const free = cargo + verifier - reserved;
    return { cargo, verifier, reserved, free: free < 0n ? 0n : free };
  }

  /** Atomic-unit chain amount of a deposit of `units` market atomic units. */
  static chainUnits(token: MarketTokenKey, units: bigint): bigint {
    return units * 10n ** BigInt(MARKET_TOKENS[token].chainDecimals - MARKET_TOKENS[token].decimals);
  }
}
