import { defineSimModule } from '../define';
import { marketReleaseHandler, marketReserveHandler, marketSettledHandler } from './module-commands';
import { marketPlaceOrderHandler } from './place-order';
import { marketCancelOrderHandler, marketSetHubFeeHandler } from './player-commands';

export * from './market-state';
export * from './colony';
export * from './place-order';
export * from './player-commands';
export * from './module-commands';

export default defineSimModule({
  id: 'trade',
  wave: 'W13',
  handlers: [
    marketPlaceOrderHandler,
    marketCancelOrderHandler,
    marketSetHubFeeHandler,
    marketReserveHandler,
    marketReleaseHandler,
    marketSettledHandler,
  ],
});
