import { Inject, Injectable } from '@nestjs/common';
import type { SimCommandV1 } from '@terra/contracts';
import { GamePlanets } from '../../game/game-planets.service.js';

export type SimOutcome = Awaited<ReturnType<GamePlanets['submit']>>;
export type SimSubmitOverride = (planetId: string, cmd: SimCommandV1) => Promise<SimOutcome>;

/**
 * The one door from the trade API to the planet sim (D-31): every mutating route sends `market.placeOrder` /
 * `market.cancelOrder` here, with `source: 'bot'` for API keys and `'player'` for sessions, exactly like a WS command.
 * `override` is a test seam (a fake sim that emits the sim's events); it is never set by the app.
 */
@Injectable()
export class TradeSimPort {
  override: SimSubmitOverride | null = null;

  constructor(@Inject(GamePlanets) private readonly planets: GamePlanets) {}

  submit(planetId: string, cmd: SimCommandV1): Promise<SimOutcome> {
    return this.override ? this.override(planetId, cmd) : this.planets.submit(planetId, cmd);
  }
}
