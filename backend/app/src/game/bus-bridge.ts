import { hasEventKind } from '@terra/contracts';
import type { PlanetEventV1 } from '../bus/channels';
import type { EventBus } from '../bus/event-bus';
import type { GamePlanets } from './game-planets.service';
import { isProgressionEventKind, ProgressionEventForwarder } from './progression-events.service';

/** Emits every sim event of every planet on the in-process bus as `planet.event` (ARCHITECTURE §6); kinds unknown to the contracts are dropped. Progression events are batched per step. */
export function bridgePlanetEvents(
  planets: GamePlanets,
  bus: EventBus,
  progressionForwarder?: ProgressionEventForwarder,
): () => void {
  const forwarder = progressionForwarder ?? new ProgressionEventForwarder(bus);
  return planets.onEvents((planetId, events) => {
    forwarder.forwardStep(planetId, events);
    for (const e of events) {
      if (!hasEventKind(e.kind)) continue;
      if (isProgressionEventKind(e.kind)) continue;
      bus.emit('planet.event', { planetId, tick: e.atTick, kind: e.kind, severity: e.severity, colonyIds: e.colonyIds, data: e.data } as PlanetEventV1);
    }
  });
}
