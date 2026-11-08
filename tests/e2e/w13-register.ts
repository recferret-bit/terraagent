import { registerBotSteps } from './w13-bots';
import { registerMultiColonySteps } from './w13-bots-multi';
import { registerTradeSteps, type TradeStepsCtx } from './w13-trade';
import { registerTradeUiSteps } from './w13-trade-ui';

/** The D-45 steps that run inside the serial w13 suite after its own market steps: trade API (9d/9e), trade page UI (9f-9r), bot API (9f-N), multi-colony reference price. */
export function registerExtraSteps(ctx: TradeStepsCtx): void {
  registerTradeSteps(ctx);
  registerBotSteps(ctx);
  registerMultiColonySteps(ctx);
  registerTradeUiSteps(ctx);
}
