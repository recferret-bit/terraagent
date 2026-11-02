import type { HomeLandingHost } from '../core/home/home.service';
import type { ColonyRecord, PlanetRecord } from '../core/home/home.repository';
import type { GamePlanets, LoadOptions } from './game-planets.service';
import type { SnapshotService } from './persistence/snapshot.service';
import { beforeTimeout, SEAT_LANDING_TIMEOUT_MS, type SeatHost, seatColonyOnPlanet, TIMED_OUT } from './seat-colony';

const paramsOf = (p: PlanetRecord): LoadOptions => ({ params: { type: p.type, seed: p.seed, radius: p.radius, capacity: p.capacity } });

async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  const out = await beforeTimeout(p, ms);
  if (out === TIMED_OUT) throw new Error(`${what} took over ${ms} ms`);
  return out;
}

/** Lands a colony row again on a planet generated fresh under it (its world was never saved): at its recorded site. */
async function reland(seat: SeatHost, planet: PlanetRecord, colony: ColonyRecord, timeoutMs: number): Promise<void> {
  const slot = { index: colony.colonyIndex, q: colony.spawnQ, r: colony.spawnR };
  await seatColonyOnPlanet(seat, { player: { id: colony.playerId, handle: colony.name }, colony, planet, slot }, timeoutMs);
}

/**
 * The game side of seating (`HomeService.setLandingHost`): the planet's own sim says where a colony lands (LED-14), and
 * an existing home's planet is restored before the home is answered (BE-14). A home planet without any snapshot is
 * generated fresh and its live colony rows are landed again at their recorded sites.
 */
export function gameLandingHost(
  snapshots: Pick<SnapshotService, 'loadNew' | 'loadHome'>, planets: Pick<GamePlanets, 'landingSite'>, seat: SeatHost, timeoutMs = SEAT_LANDING_TIMEOUT_MS,
): HomeLandingHost {
  return {
    async landingSite(planet, colonyIndex) {
      await within(snapshots.loadNew(planet.id, paramsOf(planet)), timeoutMs, `loading ${planet.id}`);
      return planets.landingSite(planet.id, colonyIndex, timeoutMs);
    },
    async ensureHomeLoaded(planet, colonies) {
      const outcome = await within(snapshots.loadHome(planet.id, paramsOf(planet)), timeoutMs, `loading ${planet.id}`);
      if (outcome !== 'generated') return;
      for (const c of await colonies()) if (c.status === 'ACTIVE') await reland(seat, planet, c, timeoutMs);
    },
  };
}
