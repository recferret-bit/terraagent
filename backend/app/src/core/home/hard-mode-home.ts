import type { ColonySummary, HomeResponse, PlanetSummary } from '@terra/contracts';

/** The fields `HardModeClock` stores. Core does not import the game clock. */
export interface HardModeHomeMark {
  readonly startedAtMs: number;
  readonly atTick: number;
  readonly cause: string;
}

/** Process-memory clock W09-31 starts. `GET /v1/me/home` reads `get` and does not scan the event log. */
export interface HardModeHomeClock {
  get(planetId: string, colonyId: string): HardModeHomeMark | undefined;
}

/** `ELIMINATED` from a clock mark. `planets` is the colony's current planet, not the recruiting picker. */
export function eliminatedHomeFromClock(
  colony: ColonySummary,
  planet: PlanetSummary,
  mark: HardModeHomeMark,
  recapSeen: boolean,
): HomeResponse {
  return {
    state: 'ELIMINATED',
    colony,
    planet,
    recap: { startedAtMs: mark.startedAtMs, atTick: mark.atTick, cause: mark.cause },
    recapSeen,
    planets: [planet],
    newPlanetTypes: [],
  };
}
