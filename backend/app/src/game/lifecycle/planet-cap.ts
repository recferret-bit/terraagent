import type { PlanetCapacityGate } from '../../core/home/parts/planet-capacity';
import type { GamePlanets } from '../game-planets.service';
import type { SimLeaseService } from '../persistence/sim-lease.service';

/**
 * The cap gate the home seat path uses (3.4). Loaded planets are counted cluster-wide from the live sim leases when
 * leases are on (an `api` replica hosts none itself), plus this process's own (a lease row may lag a fresh load).
 */
export function planetCapacityGate(
  cap: number,
  planets: Pick<GamePlanets, 'loadedIds'>,
  leases?: Pick<SimLeaseService, 'enabled' | 'findActiveLeases'>,
): PlanetCapacityGate {
  return {
    cap,
    async loadedPlanetIds() {
      const ids = new Set(planets.loadedIds());
      if (leases?.enabled) for (const l of await leases.findActiveLeases()) ids.add(l.planetId);
      return ids;
    },
  };
}
