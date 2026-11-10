import { defineSimModule } from '../define';
import { setAutoTradeHandler } from './autotrade';
import { marketReleaseHandler, marketReserveHandler, marketSettledHandler } from './module-commands';
import { marketPlaceOrderHandler } from './place-order';
import { marketCancelOrderHandler, marketSetHubFeeHandler } from './player-commands';

export * from './market-state';
export * from './colony';
export * from './market-board';
export * from './place-order';
export * from './player-commands';
export * from './module-commands';
export * from './command-source';
export * from './agent';
export {
  guildAgentParams, guildColonyInput, guildPolicy, guildQuoteParams, quoteGuild, sameGuild,
  type GuildNpc, type GuildPolicy, type GuildQuoteFixture,
} from './guild';
export * from './autotrade';

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
    setAutoTradeHandler,
  ],
});
