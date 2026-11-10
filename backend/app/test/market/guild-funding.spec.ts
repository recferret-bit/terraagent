import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { allowCashBid } from '../../src/market/guild/funding/cash-bid.js';
import {
  consumeExposure,
  releaseExposure,
  reserveExposure,
  type ExposureBook,
  type ExposureSide,
  type FundingPair,
} from '../../src/market/guild/funding/exposure.js';
import { GuildFundingService, type AllowQuoteRequest } from '../../src/market/guild/funding/guild-funding.service.js';
import type { GuildFundingRepository } from '../../src/market/guild/funding/funding.repository.js';
import { allowQuote } from '../../src/market/guild/funding/quote-gate.js';

const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const env = { NODE_ENV: 'test', DATABASE_URL: 'postgres://funding' } as AppEnv;
const side = (cap: bigint, reserved = 0n, spent = 0n): ExposureSide => ({ cap, reserved, spent });
const book = (npc: ExposureSide, global: ExposureSide = npc): ExposureBook => ({ npc, global });

describe('guild exposure cap', () => {
  it('holds an amount that fits both books', () => {
    const next = reserveExposure(book(side(10n), side(20n)), 4n);
    expect(next).toEqual({ ok: true, book: book(side(10n, 4n), side(20n, 4n)) });
  });

  it('pauses with funding_cap when the npc book would go over, and does not change it', () => {
    const open = book(side(4n), side(20n));
    const next = reserveExposure(open, 5n);
    expect(next).toEqual({ ok: false, reason: 'funding_cap', book: open });
    expect(next.book).toBe(open);
  });

  it('pauses when the npc fits but the global book does not', () => {
    const open = book(side(10n), side(4n));
    expect(reserveExposure(open, 5n)).toEqual({ ok: false, reason: 'funding_cap', book: open });
  });

  it('accepts the exact remainder and pauses one unit past it', () => {
    const open = book(side(5n, 2n, 1n));
    const exact = reserveExposure(open, 2n);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    expect(exact.book.npc).toEqual({ cap: 5n, reserved: 4n, spent: 1n });
    const past = reserveExposure(exact.book, 1n);
    expect(past).toMatchObject({ ok: false, reason: 'funding_cap' });
    expect(past.book.npc.reserved).toBe(4n);
  });

  it('releases a hold and can reserve it again', () => {
    const held = reserveExposure(book(side(5n)), 5n);
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    const freed = releaseExposure(held.book, 5n);
    expect(freed.npc.reserved).toBe(0n);
    expect(reserveExposure(freed, 5n).ok).toBe(true);
  });

  it('never lets reserved or spent go negative', () => {
    const open = book(side(5n, 1n, 2n));
    const freed = releaseExposure(open, 9n);
    expect(freed.npc).toEqual({ cap: 5n, reserved: 0n, spent: 2n });
    const eaten = consumeExposure(open, 9n);
    expect(eaten.npc).toEqual({ cap: 5n, reserved: 0n, spent: 3n });
    expect(releaseExposure(eaten, 1n).npc.spent).toBe(3n);
  });
});

describe('cash bids and quote gate', () => {
  const fresh = {
    cashEnabled: 1,
    referenceAgeS: 3600,
    eligibleVolume: 10,
    referenceMaxAgeS: 3600,
    minReferenceVolume: 10,
  };

  it('allows a cash bid at the exact age and volume limits', () => {
    expect(allowCashBid(fresh)).toBe(true);
  });

  it('pauses when cash is off, the reference is stale, or the book is thin', () => {
    expect(allowCashBid({ ...fresh, cashEnabled: 0 })).toBe(false);
    expect(allowCashBid({ ...fresh, referenceAgeS: 3601 })).toBe(false);
    expect(allowCashBid({ ...fresh, referenceAgeS: null })).toBe(false);
    expect(allowCashBid({ ...fresh, eligibleVolume: 9 })).toBe(false);
    expect(allowCashBid({ ...fresh, eligibleVolume: null })).toBe(false);
  });

  it('still allows an inventory ask while cash is paused, and pauses when stock is short or the npc is killed', () => {
    const open = book(side(5000n), side(10_000n));
    expect(allowQuote({ killed: false, bucket: 'inventory', size: 4n, stock: 4n, cashBid: false, book: open })).toEqual(
      { ok: true },
    );
    expect(allowQuote({ killed: false, bucket: 'inventory', size: 5n, stock: 4n, cashBid: false, book: open })).toEqual(
      { ok: false, reason: 'inventory_short' },
    );
    expect(allowQuote({ killed: true, bucket: 'inventory', size: 1n, stock: 4n, cashBid: false, book: open })).toEqual({
      ok: false,
      reason: 'killed',
    });
    expect(allowQuote({ killed: false, bucket: 'cash', size: 1n, stock: 0n, cashBid: false, book: open })).toEqual({
      ok: false,
      reason: 'cash_paused',
    });
  });
});

describe('allowQuote does not top up', () => {
  it('reads the book and never calls topUp, including when the cap is already spent', async () => {
    const row = { cash: side(5n, 0n, 5n), inventory: side(5000n), killed: false };
    const pair: FundingPair = { npc: row, global: row };
    const repo = { view: vi.fn(async () => pair), topUp: vi.fn() };
    const svc = new GuildFundingService(repo as unknown as GuildFundingRepository, on, env);
    const spy = vi.spyOn(svc, 'topUp');
    const request: AllowQuoteRequest = {
      npcId: 'kestrel',
      side: 'buy',
      quote: 'cash',
      size: 1n,
      stock: 0n,
      cashEnabled: 1,
      referenceAgeS: 1,
      eligibleVolume: 10,
      referenceMaxAgeS: 3600,
      minReferenceVolume: 10,
    };
    expect(await svc.allowQuote(request)).toEqual({ ok: false, reason: 'funding_cap' });
    expect(await svc.allowQuote({ ...request, cashEnabled: 0 })).toEqual({ ok: false, reason: 'cash_paused' });
    expect(spy).not.toHaveBeenCalled();
    expect(repo.topUp).not.toHaveBeenCalled();
    expect(repo.view).toHaveBeenCalledTimes(2);
  });
});
