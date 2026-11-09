import { Module } from '@nestjs/common';
import { MarketBooks } from './book/market-books.js';
import { PriceBoardService } from './board/price-board.service.js';
import { MarketBookPush } from './api/market-book-push.service.js';
import { MarketCallers } from './api/market-caller.js';
import { MarketController } from './api/market.controller.js';
import { MarketSnapshotService } from './api/market-snapshot.service.js';
import { MarketColonies } from './orders/market-colonies.js';
import { MarketFaucetCommand } from './dev/market-faucet.command.js';
import { MarketAnalyticsController } from './analytics/market-analytics.controller.js';
import { MarketAnalyticsService } from './analytics/market-analytics.service.js';
import { MarketFaucetController } from './dev/market-faucet.controller.js';
import { MarketAccountsBootstrap } from './dev/market-accounts.bootstrap.js';
import { MarketFaucetService } from './dev/market-faucet.service.js';
import { MarketSeedCommand } from './dev/market-seed.command.js';
import { MarketSeedService } from './dev/market-seed.service.js';
import { MarketFixtures } from './dev/market-fixtures.service.js';
import { MarketOrderRepository } from './book/market-order.repository.js';
import { MarketMatcher } from './matching/market-matcher.service.js';
import { HubFeeHandler } from './orders/hub-fee.handler.js';
import { CancelOrderHandler, OrderRelease } from './orders/cancel-order.service.js';
import { PlanetGameClock } from './orders/expiry-clock.js';
import { OrderExpirySweep } from './orders/expiry-sweep.js';
import { MarketFillsHook } from './orders/market-fills.hook.js';
import { MarketPolicyProvider } from './orders/market-policy.provider.js';
import { MarketSimGateway } from './orders/market-sim-gateway.js';
import { OrderFunds } from './orders/order-funds.js';
import { PlaceOrderPrecheck } from './orders/place-order.precheck.js';
import { PlaceOrderService } from './orders/place-order.service.js';
import { TradeAgentService } from './trade/trade-agent.service.js';
import { TradeAuth } from './trade/trade-auth.js';
import { TradeController } from './trade/trade.controller.js';
import { TradeDevController } from './trade/trade-dev.controller.js';
import { TradeKeyRepository } from './trade/trade-key.repository.js';
import { TradeKeysService } from './trade/trade-keys.service.js';
import { TradeOrdersService } from './trade/trade-orders.service.js';
import { TradeReadService } from './trade/trade-read.service.js';
import { TradeRequestLinker } from './trade/trade-request-linker.js';
import { TradeRequestRepository } from './trade/trade-request.repository.js';
import { TradeSimPort } from './trade/trade-sim.port.js';
import { TradeStallService } from './trade/trade-stall.service.js';
import { TradeStreamService } from './trade/trade-stream.service.js';
import { GameModule } from '../game/game.module.js';
import { IntentTradeRepository } from './settlement/intent-trade.repository.js';
import { SettlementFillsHook } from './settlement/settlement-fills.hook.js';
import { TradeRecovery } from './settlement/trade-recovery.service.js';
import { TradeSettlement } from './settlement/trade-settlement.service.js';
import { MarketMetrics } from './telemetry/market-metrics.js';
import { NearModule } from '../near/near.module.js';
import { EconomyModule } from '../economy/economy.module.js';
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
    HubFeeHandler,
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
    MarketColonies,
    MarketSnapshotService,
    { provide: MarketFillsHook, useExisting: SettlementFillsHook },
    MarketFaucetService,
    MarketFixtures,
    MarketFaucetCommand,
    MarketSeedService,
    MarketSeedCommand,
    MarketProgressionProducer,
    TradeHistoryProducer,
    MarketMetrics,
    MarketAnalyticsService,
    TradeKeyRepository,
    TradeRequestRepository,
    TradeRequestLinker,
    TradeSimPort,
    TradeAuth,
    TradeOrdersService,
    TradeKeysService,
    TradeReadService,
    TradeStreamService,
    TradeAgentService,
    TradeStallService,
  ],
  controllers: [
    MarketController,
    MarketFaucetController,
    MarketAnalyticsController,
    TradeController,
    TradeDevController,
  ],
  imports: [
    NearModule,
    EconomyModule,
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
    TradeSimPort,
  ],
})
export class MarketModule {}
