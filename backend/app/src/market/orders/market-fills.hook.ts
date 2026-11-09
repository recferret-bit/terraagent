import { Injectable, Logger } from '@nestjs/common';
import type { TransactionClient } from '@terra/db';
import type { MatchOutcome } from '../matching/market-matcher.service.js';

/**
 * Receives the fills of a newly OPEN order inside the matcher's transaction (the locks are still held), so it can write
 * the order updates, the trade rows and the outbox rows atomically. Returns the order ids it touched (the caller syncs the
 * book for them after commit). W13-13 provides the settlement implementation; the default only logs.
 */
export abstract class MarketFillsHook {
  abstract onFills(outcome: MatchOutcome, tx: TransactionClient): Promise<string[]>;
}

@Injectable()
export class LoggingMarketFillsHook extends MarketFillsHook {
  private readonly log = new Logger('MarketFills');

  onFills(outcome: MatchOutcome): Promise<string[]> {
    this.log.log(`order ${outcome.incoming?.orderId ?? '?'}: ${outcome.fills.length} fill(s), remainder ${outcome.restingRemainder}`);
    return Promise.resolve([]);
  }
}
