import { Module } from '@nestjs/common';
import { MarketBooks } from './book/market-books.js';
import { PriceBoardService } from './board/price-board.service.js';
import { MarketBookPush } from './api/market-book-push.service.js';
import { MarketCallers } from './api/market-caller.js';
import { MarketController } from './api/market.controller.js';
import { MarketSnapshotService } from './api/market-snapshot.service.js';
import { MarketFaucetCommand } from './dev/market-faucet.command.js';
import { MarketFaucetController } from './dev/market-faucet.controller.js';
import { MarketAccountsBootstrap } from './dev/market-accounts.bootstrap.js';
import { MarketFaucetService } from './dev/market-faucet.service.js';
import { MarketOrderRepository } from './book/market-order.repository.js';
import { MarketMatcher } from './matching/market-matcher.service.js';
import { CancelOrderHandler, OrderRelease } from './orders/cancel-order.service.js';
import { PlanetGameClock } from './orders/expiry-clock.js';
import { OrderExpirySweep } from './orders/expiry-sweep.js';
import { MarketFillsHook } from './orders/market-fills.hook.js';
import { MarketPolicyProvider } from './orders/market-policy.provider.js';
import { MarketSimGateway } from './orders/market-sim-gateway.js';
import { OrderFunds } from './orders/order-funds.js';
import { PlaceOrderPrecheck } from './orders/place-order.precheck.js';
import { PlaceOrderService } from './orders/place-order.service.js';
import { GameModule } from '../game/game.module.js';
import { IntentTradeRepository } from './settlement/intent-trade.repository.js';
import { SettlementFillsHook } from './settlement/settlement-fills.hook.js';
import { TradeRecovery } from './settlement/trade-recovery.service.js';
import { TradeSettlement } from './settlement/trade-settlement.service.js';
import { MarketMetrics } from './telemetry/market-metrics.js';
import { NearModule } from '../near/near.module.js';
import { TradeHistoryProducer } from './progression/trade-history.producer.js';
import { MarketProgressionProducer } from './progression/market-progression.producer.js';

/**
 * W13 F2 markets (mock settlement): order book, matcher, batch builder, settlement, cancellation/expiry, price board,
 * `GET /v1/market/{planetId}` and the `market.book` / `market.trade` pushes. See `README.md` for the file layout each
 * issue adds to. Game rules shared with experiments (matching, fees, batch math) live in `shared/sim/src/systems/trade/`.
 */
@Module({
  providers: [
    MarketOrderRepository,
    MarketBooks,
    MarketMatcher,
    MarketPolicyProvider,
    MarketSimGateway,
    OrderFunds,
    PlaceOrderPrecheck,
    PlaceOrderService,
    OrderRelease,
    CancelOrderHandler,
    PlanetGameClock,
    OrderExpirySweep,
    IntentTradeRepository,
    SettlementFillsHook,
    TradeSettlement,
    TradeRecovery,
    MarketAccountsBootstrap,
    PriceBoardService,
    MarketBookPush,
    MarketCallers,
    MarketSnapshotService,
    { provide: MarketFillsHook, useExisting: SettlementFillsHook },
    MarketFaucetService,
    MarketFaucetCommand,
    MarketProgressionProducer,
    TradeHistoryProducer,
    MarketMetrics,
  ],
  controllers: [
    MarketController,
    MarketFaucetController,
  ],
  imports: [
    NearModule,
    GameModule,
  ],
  exports: [
    OrderRelease,
    MarketOrderRepository,
    MarketBooks,
    MarketMatcher,
    MarketPolicyProvider,
    MarketSimGateway,
    OrderFunds,
    MarketFillsHook,
    IntentTradeRepository,
    TradeSettlement,
    TradeRecovery,
    PriceBoardService,
  ],
})
export class MarketModule {}
