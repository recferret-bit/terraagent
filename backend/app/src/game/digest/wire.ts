import { restore } from '@terra/sim';
import type { EventBus } from '../../bus/event-bus';
import type { GamePlanets } from '../game-planets.service';
import { baselineFromState } from './baseline';
import { AwayDigestService } from './service';
import type { BaselineReader } from './types';

/** Live stock / power / robots / territory. A miss leaves the zero baseline for the next snapshot (BE-57). */
export function liveBaselineReader(planets: Pick<GamePlanets, 'fullState'>): BaselineReader {
  return {
    async read(planetId, colonyId) {
      const full = await planets.fullState(planetId, 750);
      return baselineFromState(restore(full.bytes), colonyId);
    },
  };
}

export function attachAwayDigest(bus: Pick<EventBus, 'on'>, digests: AwayDigestService): () => void {
  return bus.on('planet.event', (event) => digests.onPlanetEvent(event), { module: 'AwayDigest' });
}
