import { Module } from '@nestjs/common';
import { MarketBooks } from './book/market-books.js';
import { MarketOrderRepository } from './book/market-order.repository.js';
import { MarketMatcher } from './matching/market-matcher.service.js';
import { LoggingMarketFillsHook, MarketFillsHook } from './orders/market-fills.hook.js';
import { MarketPolicyProvider } from './orders/market-policy.provider.js';
import { MarketSimGateway } from './orders/market-sim-gateway.js';
import { OrderFunds } from './orders/order-funds.js';
import { PlaceOrderPrecheck } from './orders/place-order.precheck.js';
import { PlaceOrderService } from './orders/place-order.service.js';
import { NearModule } from '../near/near.module.js';

/**
 * W13 F2 markets (mock settlement): order book, matcher, batch builder, settlement, cancellation/expiry, price board,
 * `GET /v1/market/{planetId}` and the `market.book` / `market.trade` pushes. See `README.md` for the file layout each
 * issue adds to. Game rules shared with experiments (matching, fees, batch math) live in `shared/sim/src/systems/trade/`.
 */
@Module({
  providers: [
    MarketOrderRepository, MarketBooks, MarketMatcher, MarketPolicyProvider, MarketSimGateway, OrderFunds, PlaceOrderPrecheck, PlaceOrderService,
    { provide: MarketFillsHook, useClass: LoggingMarketFillsHook },
  ],
  controllers: [],
  imports: [NearModule],
  exports: [MarketOrderRepository, MarketBooks, MarketMatcher, MarketPolicyProvider, MarketSimGateway, OrderFunds, MarketFillsHook],
})
export class MarketModule {}
