import { Module } from '@nestjs/common';
import { MarketBooks } from './book/market-books.js';
import { MarketFaucetCommand } from './dev/market-faucet.command.js';
import { MarketFaucetController } from './dev/market-faucet.controller.js';
import { MarketFaucetService } from './dev/market-faucet.service.js';
import { MarketOrderRepository } from './book/market-order.repository.js';

/**
 * W13 F2 markets (mock settlement): order book, matcher, batch builder, settlement, cancellation/expiry, price board,
 * `GET /v1/market/{planetId}` and the `market.book` / `market.trade` pushes. See `README.md` for the file layout each
 * issue adds to. Game rules shared with experiments (matching, fees, batch math) live in `shared/sim/src/systems/trade/`.
 */
@Module({ providers: [MarketOrderRepository, MarketBooks, MarketFaucetService, MarketFaucetCommand], controllers: [MarketFaucetController], imports: [], exports: [MarketOrderRepository, MarketBooks] })
export class MarketModule {}
