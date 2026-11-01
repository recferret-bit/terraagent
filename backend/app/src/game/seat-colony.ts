import { CoreConflict } from '../core/errors';
import { type ColonySeatAssignment, createSpawnColonyCommand } from '../core/home/home.service';
import type { GamePlanets } from './game-planets.service';

/**
 * Lands a newly seated colony on its planet (loading the planet first). The sim may reject `system.spawnColony`
 * (`already_landed`, `landing_site_taken`, …): that is not a seat, so it throws `COLONY_SEAT_REJECTED` (409, the
 * sim's code in `details.code`) and `HomeService` rolls the colony row back instead of answering ACTIVE.
 */
export async function seatColonyOnPlanet(planets: Pick<GamePlanets, 'ensureLoaded' | 'submit'>, assignment: ColonySeatAssignment): Promise<void> {
  const { planet, colony } = assignment;
  await planets.ensureLoaded(planet.id, {
    params: { type: planet.type, seed: planet.seed, radius: planet.radius, capacity: planet.capacity },
  });
  const out = await planets.submit(planet.id, createSpawnColonyCommand(assignment));
  if (out.ok) return;
  throw new CoreConflict('COLONY_SEAT_REJECTED', {
    message: `landing of colony ${colony.id} on ${planet.id} rejected by the sim: ${out.code}`,
    details: { code: out.code, planetId: planet.id, colonyId: colony.id, colonyIndex: colony.colonyIndex },
  });
}
