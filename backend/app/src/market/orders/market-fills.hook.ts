import { Injectable, Logger } from '@nestjs/common';
import type { MatchOutcome } from '../matching/market-matcher.service.js';

/** Receives the fills of a newly OPEN order. W13-12/13 provide the batch builder and settlement; the default only logs. */
export abstract class MarketFillsHook {
  abstract onFills(outcome: MatchOutcome): Promise<void>;
}

@Injectable()
export class LoggingMarketFillsHook extends MarketFillsHook {
  private readonly log = new Logger('MarketFills');

  onFills(outcome: MatchOutcome): Promise<void> {
    this.log.log(`order ${outcome.incoming?.orderId ?? '?'}: ${outcome.fills.length} fill(s), remainder ${outcome.restingRemainder}`);
    return Promise.resolve();
  }
}
