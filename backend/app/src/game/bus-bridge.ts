import { hasEventKind } from '@terra/contracts';
import type { Logger } from 'pino';
import type { PlanetEventV1 } from '../bus/channels';
import type { EventBus } from '../bus/event-bus';
import type { NearCargoSettledBusEvent } from '../near/cargo/cargo-relay-settlement';
import type { NearMarketCommandBusEvent } from '../market/orders/market-sim-gateway';
import type { GamePlanets } from './game-planets.service';
import { isProgressionEventKind, ProgressionEventForwarder } from './progression-events.service';

/**
 * Emits every sim event of every planet on the in-process bus as `planet.event` (ARCHITECTURE §6); kinds unknown to the
 * contracts are dropped. Progression events are batched per step. Also routes `near.cargo.settled` bus events into the
 * target planet as `cargo.settled` commands (W10-09, W10-13). The bridge runs inside the thread message listener,
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
  let settledSeq = 0;
  const guard = (planetId: string, what: string, fn: () => void) => {
    try { fn(); } catch (e) { log.error({ planetId, err: e instanceof Error ? e.message : String(e) }, `bus bridge: ${what} dropped`); }
  };
  const unsubEvents = planets.onEvents((planetId, events) => {
    guard(planetId, 'progression batch', () => forwarder.forwardStep(planetId, events));
    for (const e of events) {
      if (!hasEventKind(e.kind)) continue;
      if (isProgressionEventKind(e.kind)) continue;
      guard(planetId, `event ${e.kind}`, () => bus.emit('planet.event', { planetId, tick: e.atTick, kind: e.kind, severity: e.severity, colonyIds: e.colonyIds, data: e.data } as PlanetEventV1));
    }
  });
  const unsubCargoSettled =
    typeof bus.on === 'function'
      ? bus.on(
          'near.cargo.settled',
          (ev: NearCargoSettledBusEvent) => {
            if (typeof planets.submit !== 'function') return;
            const commandId = `cs-${Date.now().toString(36)}-${(++settledSeq).toString(36)}`;
            void planets
              .submit(ev.planetId, {
                colonyIndex: ev.colonyIndex,
                source: 'near',
                commandId,
                kind: 'cargo.settled',
                args: {
                  colonyId: ev.colonyId,
                  ref: ev.ref,
                  direction: ev.direction,
                  resource: ev.resource,
                  amount: ev.amount,
                  ok: ev.ok,
                  ...(ev.txHash ? { txHash: ev.txHash } : {}),
                  ...(ev.error ? { error: ev.error } : {}),
                },
              })
              .catch((e: unknown) => {
                log.error(
                  { planetId: ev.planetId, err: e instanceof Error ? e.message : String(e) },
                  'bus bridge: cargo.settled submit failed',
                );
              });
          },
          { module: 'GameBusBridge' },
        )
      : undefined;
  let marketSeq = 0;
  const unsubMarket =
    typeof bus.on === 'function'
      ? bus.on(
          'near.market.command',
          (ev: NearMarketCommandBusEvent) => {
            if (typeof planets.submit !== 'function') return;
            void planets
              .submit(ev.planetId, { colonyIndex: ev.colonyIndex, source: 'near', commandId: `mk-${Date.now().toString(36)}-${(++marketSeq).toString(36)}`, kind: ev.kind, args: ev.args })
              .catch((e: unknown) => {
                log.error({ planetId: ev.planetId, err: e instanceof Error ? e.message : String(e) }, `bus bridge: ${ev.kind} submit failed`);
              });
          },
          { module: 'GameBusBridge' },
        )
      : undefined;
  return () => {
    unsubEvents();
    unsubCargoSettled?.();
    unsubMarket?.();
  };
}
