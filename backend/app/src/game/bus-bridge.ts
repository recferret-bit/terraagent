import { hasEventKind } from '@terra/contracts';
import type { Logger } from 'pino';
import type { PlanetEventV1 } from '../bus/channels';
import type { EventBus } from '../bus/event-bus';
import type { GamePlanets } from './game-planets.service';
import { isProgressionEventKind, ProgressionEventForwarder } from './progression-events.service';

/**
 * Emits every sim event of every planet on the in-process bus as `planet.event` (ARCHITECTURE §6); kinds unknown to the
 * contracts are dropped. Progression events are batched per step. The bridge runs inside the thread message listener,
 * before the delta reaches the planet's sockets: an event the bus refuses (its `data` fails the contract, checked
 * outside production) or a forwarder error is logged and skipped, never thrown (BE-13).
 */
export function bridgePlanetEvents(
  planets: GamePlanets,
  bus: EventBus,
  progressionForwarder?: ProgressionEventForwarder,
  log: Pick<Logger, 'error'> = { error: () => undefined },
): () => void {
  const forwarder = progressionForwarder ?? new ProgressionEventForwarder(bus);
  const guard = (planetId: string, what: string, fn: () => void) => {
    try { fn(); } catch (e) { log.error({ planetId, err: e instanceof Error ? e.message : String(e) }, `bus bridge: ${what} dropped`); }
  };
  return planets.onEvents((planetId, events) => {
    guard(planetId, 'progression batch', () => forwarder.forwardStep(planetId, events));
    for (const e of events) {
      if (!hasEventKind(e.kind)) continue;
      if (isProgressionEventKind(e.kind)) continue;
      guard(planetId, `event ${e.kind}`, () => bus.emit('planet.event', { planetId, tick: e.atTick, kind: e.kind, severity: e.severity, colonyIds: e.colonyIds, data: e.data } as PlanetEventV1));
    }
  });
}
