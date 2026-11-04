import { Module } from '@nestjs/common';
import { MarketBooks } from './book/market-books.js';
import { MarketOrderRepository } from './book/market-order.repository.js';

/**
 * W13 F2 markets (mock settlement): order book, matcher, batch builder, settlement, cancellation/expiry, price board,
 * `GET /v1/market/{planetId}` and the `market.book` / `market.trade` pushes. See `README.md` for the file layout each
 * issue adds to. Game rules shared with experiments (matching, fees, batch math) live in `shared/sim/src/systems/trade/`.
 */
@Module({ providers: [MarketOrderRepository, MarketBooks], controllers: [], imports: [], exports: [MarketOrderRepository, MarketBooks] })
export class MarketModule {}
