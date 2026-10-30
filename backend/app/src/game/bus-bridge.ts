import { hasEventKind } from '@terra/contracts';
import type { PlanetEventV1 } from '../bus/channels';
import type { EventBus } from '../bus/event-bus';
import type { GamePlanets } from './game-planets.service';

/** Emits every sim event of every planet on the in-process bus as `planet.event` (ARCHITECTURE §6); kinds unknown to the contracts are dropped. */
export function bridgePlanetEvents(planets: GamePlanets, bus: EventBus): () => void {
  return planets.onEvents((planetId, events) => {
    for (const e of events) {
      if (!hasEventKind(e.kind)) continue;
      bus.emit('planet.event', { planetId, tick: e.atTick, kind: e.kind, severity: e.severity, colonyIds: e.colonyIds, data: e.data } as PlanetEventV1);
    }
  });
}
