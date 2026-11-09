import { BotApi } from './w13-bots-api';
import { registerAuthSteps, registerInputSteps, registerLimitSteps } from './w13-bots-auth';
import { registerChaosSteps, registerFaultSteps } from './w13-bots-chaos';
import { registerFillSteps } from './w13-bots-fills';
import { registerQuoteSteps } from './w13-bots-quote';
import { registerKeyRailSteps, registerRailSteps } from './w13-bots-rails';
import { registerStreamSteps } from './w13-bots-stream';
import type { TradeStepsCtx } from './w13-trade';

/**
 * W13 D-45 bot / agent trading API on the REAL stack (sim, settlement, mock chain), steps 9f-1 .. 9f-22. Registered inside the
 * serial w13 suite after steps 9d/9e (`registerBotSteps(ctx)`; the suite needs the planet from step 1).
 *
 * Parties: only two sim colonies exist on the w13 planet (col_0 = A, col_1 = B), so every dev bot sits on one of them and shares
 * that colony's mock account with the human session: `ba`/`bc` on col_0, `bb`/`bd` on col_1, `ba2` = `ba`'s owner on col_1.
 * Every step starts from `api.reset()` (no resting order, no fault, no reservation) and leaves the book clean.
 * Not coverable on this two-colony scenario: the organic reference price (VWAP) and the steps that depend on it (9f-1b, 9f-7b,
 * 9f-22b). They run on the four-colony scenario `w13m` in `w13-bots-multi.ts` (`registerMultiColonySteps(ctx)`, its own planet).
 */
export function registerBotSteps(ctx: TradeStepsCtx): void {
  const api = new BotApi(ctx);
  registerFillSteps(api);
  registerRailSteps(api);
  registerKeyRailSteps(api);
  registerAuthSteps(api);
  registerInputSteps(api);
  registerLimitSteps(api);
  registerStreamSteps(api);
  registerChaosSteps(api);
  registerFaultSteps(api);
  registerQuoteSteps(api);
}
