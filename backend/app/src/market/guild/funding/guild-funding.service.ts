import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import { FlagsService } from '../../../flags/flags.service.js';
import { GuildProvisionError } from '../guild-error.js';
import { allowCashBid, type CashBidView } from './cash-bid.js';
import { fundingEnabled, inventoryCapOf } from './caps.js';
import { bookOf, type ExposureBook, type FundingBucket, type FundingPair, type ReserveResult } from './exposure.js';
import { GuildFundingRepository } from './funding.repository.js';
import { allowQuote as gateQuote, quoteBucket, type QuoteGateResult } from './quote-gate.js';

export interface AllowQuoteRequest extends CashBidView {
  readonly npcId: string;
  readonly side: 'buy' | 'sell';
  readonly quote: 'cash' | 'inventory';
  readonly size: bigint;
  /** Free units of the inventory token. Ignored for a cash buy. */
  readonly stock: bigint;
}

/**
 * Guild funding guard on top of the W13 allowances (W15-12). Boot does not construct this to add funds.
 * `allowQuote` only reads. `topUp` is the only increase.
 */
@Injectable()
export class GuildFundingService {
  constructor(
    private readonly repo: GuildFundingRepository,
    private readonly flags: FlagsService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  /** Preview. Does not reserve and does not call `topUp`. */
  async allowQuote(input: AllowQuoteRequest): Promise<QuoteGateResult> {
    if (!this.live()) return { ok: false, reason: 'funding_cap' };
    const snap = await this.read(input.npcId);
    const bucket = quoteBucket(input.side, input.quote);
    return gateQuote({
      killed: snap.npc.killed,
      bucket,
      size: input.size,
      stock: input.stock,
      cashBid: allowCashBid(input),
      book: bookOf(snap, bucket),
    });
  }

  read(npcId: string): Promise<FundingPair> {
    this.requireLive();
    return this.repo.view(npcId, this.inventoryCap());
  }

  reserve(npcId: string, bucket: FundingBucket, amount: bigint): Promise<ReserveResult> {
    if (!this.live()) return Promise.resolve({ ok: false, reason: 'funding_cap', book: emptyBook() });
    return this.repo.reserve(npcId, this.inventoryCap(), bucket, amount);
  }

  release(npcId: string, bucket: FundingBucket, amount: bigint): Promise<ExposureBook> {
    this.requireLive();
    return this.repo.release(npcId, this.inventoryCap(), bucket, amount);
  }

  consume(npcId: string, bucket: FundingBucket, amount: bigint): Promise<ExposureBook> {
    this.requireLive();
    return this.repo.consume(npcId, this.inventoryCap(), bucket, amount);
  }

  /** Operator allocation. Not used by boot, `allowQuote`, or reserve. */
  topUp(allocationId: string, amount: bigint): Promise<{ cashCapAtomic: string; globalCashCapAtomic: string }> {
    this.requireLive();
    return this.repo.topUp(allocationId, amount, this.inventoryCap());
  }

  private live(): boolean {
    return fundingEnabled(this.flags, this.env);
  }

  private requireLive(): void {
    if (!this.live()) throw new GuildProvisionError('not_provisioned', 'Guild funding is off');
  }

  private inventoryCap(): bigint {
    return inventoryCapOf((wave) => this.flags.has(wave));
  }
}

function emptyBook(): ExposureBook {
  const side = { reserved: 0n, spent: 0n, cap: 0n };
  return { npc: side, global: side };
}
