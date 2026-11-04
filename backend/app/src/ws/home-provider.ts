import type { HomeResponse } from '@terra/contracts';
import { DEV_PLANET_TYPE } from '@terra/sim';
import type { HomeService } from '../core/home/home.service';

/** Resolves the player's `HomeResponse` for the WS `ready` payload (PROTOCOL §4.3, W01-03). */
export interface HomeProvider {
  getHome(playerId: string, planetId?: string): Promise<HomeResponse>;
}

export const HOME_PROVIDER = Symbol('HOME_PROVIDER');

export const DEFAULT_HOME: HomeResponse = {
  state: 'NEW',
  planets: [],
  newPlanetTypes: [DEV_PLANET_TYPE],
};

/**
 * Default WS home provider: the player's home from `HomeService` (the same summaries as `/me/home`), else the `NEW`
 * home (BE-10: no second query, no hand-built summaries). Errors propagate (the connection answers `NEW` on them).
 */
export class DbHomeProvider implements HomeProvider {
  constructor(private readonly homeService?: Pick<HomeService, 'getExistingHome'>) {}

  async getHome(playerId: string, planetId?: string): Promise<HomeResponse> {
    return (await this.homeService?.getExistingHome(playerId, planetId)) ?? DEFAULT_HOME;
  }
}
