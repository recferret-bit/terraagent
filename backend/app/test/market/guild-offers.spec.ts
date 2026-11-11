import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@terra/db';
import { EventBus } from '../../src/bus/event-bus.js';
import type { AppEnv } from '../../src/core/tokens.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { MarketBooks } from '../../src/market/book/market-books.js';
import type { MarketOrderRepository } from '../../src/market/book/market-order.repository.js';
import { AcceptGuildOfferService } from '../../src/market/guild/offers/accept-guild-offer.service.js';
import { curateGuildOffers, judgeOffer, type OfferQuote } from '../../src/market/guild/offers/curate.js';
import { guildOfferId } from '../../src/market/guild/offers/offer-id.js';
import type { GuildOffersService } from '../../src/market/guild/offers/guild-offers.service.js';
import type { MarketFillsHook } from '../../src/market/orders/market-fills.hook.js';

const npc = 'guild-1.npc.terraagent.mock';

function quote(over: Partial<OfferQuote> & Pick<OfferQuote, 'orderId' | 'base' | 'quote' | 'side' | 'priceAmount'>): OfferQuote {
  return {
    shipId: 'kestrel', npcId: 'kestrel', npcAccountId: npc, amount: 10n, filled: 0n, quoteSeq: 0, ...over,
  };
}

describe('curated Guild offers (W15-11)', () => {
  it('keeps the best price per pair and side, drops the 7th, and rejects a stale id', () => {
    const worse = quote({ orderId: 'worse', base: 'metals.t1', quote: 'minerals.t1', side: 'sell', priceAmount: 20n });
    const best = quote({ orderId: 'best', base: 'metals.t1', quote: 'minerals.t1', side: 'sell', priceAmount: 8n });
    const kept = curateGuildOffers([worse, best]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ offerId: guildOfferId('best', 0), action: 'buy', amount: 10, price: { token: 'minerals.t1', amount: '8' } });
    expect(kept[0]?.reason).toContain('Guild kestrel selling surplus metals.t1');

    const higher = quote({ orderId: 'high', base: 'metals.t1', quote: 'minerals.t1', side: 'buy', priceAmount: 12n });
    const lower = quote({ orderId: 'low', base: 'metals.t1', quote: 'minerals.t1', side: 'buy', priceAmount: 5n });
    expect(curateGuildOffers([lower, higher])[0]?.offerId).toBe(guildOfferId('high', 0));

    const seven = [
      quote({ orderId: 'a', base: 'bio.biomass', quote: 'metals.t1', side: 'sell', priceAmount: 3n }),
      quote({ orderId: 'b', base: 'bio.biomass', quote: 'metals.t1', side: 'buy', priceAmount: 3n }),
      quote({ orderId: 'c', base: 'bio.water', quote: 'bio.biomass', side: 'sell', priceAmount: 3n }),
      quote({ orderId: 'd', base: 'bio.water', quote: 'bio.biomass', side: 'buy', priceAmount: 3n }),
      quote({ orderId: 'e', base: 'metals.t1', quote: 'minerals.t1', side: 'sell', priceAmount: 3n }),
      quote({ orderId: 'f', base: 'metals.t1', quote: 'minerals.t1', side: 'buy', priceAmount: 3n }),
      quote({ orderId: 'seventh', base: 'minerals.t1', quote: 'bio.water', side: 'sell', priceAmount: 3n }),
    ];
    const capped = curateGuildOffers(seven);
    expect(capped).toHaveLength(6);
    expect(capped.map((row) => row.offerId)).not.toContain(guildOfferId('seventh', 0));

    const live = quote({ orderId: 'mo_live', base: 'metals.t1', quote: 'minerals.t1', side: 'sell', priceAmount: 15n, quoteSeq: 2 });
    const stale = judgeOffer(guildOfferId('mo_live', 1), [live], true);
    expect(stale).toEqual({ ok: false, code: 'offer_expired', detail: 'new price minerals.t1 15' });
    expect(judgeOffer(guildOfferId('mo_live', 2), [live], true).ok).toBe(true);
    expect(judgeOffer(guildOfferId('mo_live', 2), [live], false)).toEqual({ ok: false, code: 'offer_expired' });
  });

  it('offers only the amount that still fills, and W15 off rejects the command', async () => {
    const partial = quote({ orderId: 'part', base: 'bio.water', quote: 'bio.biomass', side: 'sell', amount: 10n, filled: 4n, priceAmount: 15n });
    expect(curateGuildOffers([partial])[0]).toMatchObject({ amount: 6, price: { amount: '9' }, action: 'buy' });
    const accept = new AcceptGuildOfferService(
      { has: () => false } as unknown as FlagsService,
      {} as GuildOffersService,
      {} as MarketOrderRepository,
      {} as MarketBooks,
      {} as MarketFillsHook,
      new EventBus(),
      {} as PrismaClient,
      { NODE_ENV: 'test' } as AppEnv,
    );
    expect(await accept.accept({ offerId: guildOfferId('x', 0), planetId: 'pl', colonyId: 'co', colonyIndex: 0, playerId: 'pr' })).toEqual({
      ok: false, code: 'wave_disabled',
    });
  });
});
