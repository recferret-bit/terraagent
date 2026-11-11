import { hasEventKind } from '@terra/contracts';
import type { Logger } from 'pino';
import type { PlanetEventV1 } from '../bus/channels';
import type { EventBus } from '../bus/event-bus';
import { extractEliminatedColonyIds } from '../lobby/reconciliation.helpers';
import type { NearCargoSettledBusEvent } from '../near/cargo/cargo-relay-settlement';
import type { NearMarketCommandBusEvent } from '../market/orders/market-sim-gateway';
import type { GamePlanets } from './game-planets.service';
import { isProgressionEventKind, ProgressionEventForwarder } from './progression-events.service';

export interface BusBridgeReconciliation {
  eliminateColony(
    colonyId: string,
    options?: { readonly planetId?: string; readonly now?: Date },
  ): Promise<unknown>;
  bindEventBus?(bus: EventBus): () => void;
}

function normalizeBusEventData(kind: string, data: unknown): unknown {
  if ((kind !== 'raidStarted' && kind !== 'raidRepelled') || !data || typeof data !== 'object') {
    return data;
  }
  const rec = data as Record<string, unknown>;
  if (!('attackerName' in rec) && !('byColony' in rec)) return data;
  const { attackerName, byColony, ...rest } = rec;
  const alias =
    typeof attackerName === 'string' && attackerName.trim()
      ? attackerName.trim()
      : typeof byColony === 'string' && byColony.trim()
        ? byColony.trim()
        : undefined;
  if (alias && (typeof rest.species !== 'string' || !rest.species.trim())) {
    rest.species = alias;
  }
  return rest;
}

function bindNearCommandBusListeners(
  planets: GamePlanets,
  bus: EventBus,
  log: Pick<Logger, 'error'>,
): (() => void)[] {
  if (typeof bus.on !== 'function') return [];
  let settledSeq = 0;
  let marketSeq = 0;
  const unsubCargoSettled = bus.on(
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
  );
  const unsubMarket = bus.on(
    'near.market.command',
    (ev: NearMarketCommandBusEvent) => {
      if (typeof planets.submit !== 'function') return;
      const commandId = `mk-${Date.now().toString(36)}-${(++marketSeq).toString(36)}`;
      void planets
        .submit(ev.planetId, { colonyIndex: ev.colonyIndex, source: 'near', commandId, kind: ev.kind, args: ev.args })
        .catch((e: unknown) => {
          log.error({ planetId: ev.planetId, err: e instanceof Error ? e.message : String(e) }, `bus bridge: ${ev.kind} submit failed`);
        });
    },
    { module: 'GameBusBridge' },
  );
  return [unsubCargoSettled, unsubMarket];
}

/**
 * Emits every sim event of every planet on the in-process bus as `planet.event` (ARCHITECTURE §6); kinds unknown to the
 * contracts are dropped. Progression events are batched per step. Also routes `near.cargo.settled` bus events into the
 * target planet as `cargo.settled` commands (W10-09, W10-13) and forwards `colonyEliminated` to `WorldReconciliationService`
 * (W18-33). The bridge runs inside the thread message listener, before the delta reaches the planet's sockets: an event the
 * bus refuses (its `data` fails the contract, checked outside production) or a forwarder error is logged and skipped, never
 * thrown (BE-13).
 */
export function bridgePlanetEvents(
  planets: GamePlanets,
  bus: EventBus,
  progressionForwarder?: ProgressionEventForwarder,
  log: Pick<Logger, 'error'> = { error: () => undefined },
  reconciliation?: BusBridgeReconciliation,
): () => void {
  const forwarder = progressionForwarder ?? new ProgressionEventForwarder(bus);
  const forwardEliminated = (planetId: string, ev: { readonly colonyIds?: readonly unknown[]; readonly data?: unknown }) => {
    if (!reconciliation) return;
    for (const colId of extractEliminatedColonyIds(ev)) {
      void reconciliation.eliminateColony(colId, { planetId }).catch((e: unknown) => {
        log.error({ planetId, err: e instanceof Error ? e.message : String(e) }, 'bus bridge: eliminateColony failed');
      });
    }
  };
  const guard = (planetId: string, what: string, fn: () => void) => {
    try { fn(); } catch (e) { log.error({ planetId, err: e instanceof Error ? e.message : String(e) }, `bus bridge: ${what} dropped`); }
  };
  const unsubEvents = planets.onEvents((planetId, events) => {
    guard(planetId, 'progression batch', () => forwarder.forwardStep(planetId, events));
    for (const e of events) {
      if (!hasEventKind(e.kind) || isProgressionEventKind(e.kind)) continue;
      const data = normalizeBusEventData(e.kind, e.data);
      guard(planetId, `event ${e.kind}`, () => bus.emit('planet.event', { planetId, tick: e.atTick, kind: e.kind, severity: e.severity, colonyIds: e.colonyIds, data } as PlanetEventV1));
      if (e.kind === 'colonyEliminated' && typeof bus.on !== 'function') forwardEliminated(planetId, e);
    }
  });
  const unsubEliminated =
    reconciliation && typeof bus.on === 'function'
      ? typeof reconciliation.bindEventBus === 'function'
        ? reconciliation.bindEventBus(bus)
        : bus.on(
            'planet.event',
            (ev: PlanetEventV1) => {
              if (ev.kind === 'colonyEliminated') forwardEliminated(ev.planetId, ev);
            },
            { module: 'GameBusBridgeReconciliation' },
          )
      : undefined;
  const nearUnsubs = bindNearCommandBusListeners(planets, bus, log);
  return () => {
    unsubEvents();
    unsubEliminated?.();
    for (const fn of nearUnsubs) fn();
  };
}
