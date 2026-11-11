import 'reflect-metadata';
import { CANONICAL_PLANETS, DIGEST_LIST_CAP } from '@terra/contracts';
import type { SimEvent } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../bus/event-bus';
import { HomeRepository } from '../../core/home/home.repository';
import {
  CanonicalWorldProvisioningService,
  LobbyPersistenceService,
  MemoryLobbyStore,
  SectorReservationService,
  SpawnSagaService,
  WorldLifecycleService,
  WorldReconciliationService,
} from '../../lobby';
import { AlertRouter } from '../../notify/alert-router';
import { MockNotifier } from '../../notify/mock-notifier';
import { InMemoryMockNotifyStore } from '../../notify/mock-notify.store';
import { ColonyPresenceRegistry } from '../../notify/presence';
import { NotifierPort, type Notification, type NotificationResult } from '../../ports/notifier.port';
import { bridgePlanetEvents } from '../bus-bridge';
import type { GamePlanets } from '../game-planets.service';
import { MemoryDigestStore } from './memory-store';
import { AwayDigestService } from './service';
import { attachAwayDigest } from './wire';

const PLANET = CANONICAL_PLANETS.desert.id;
const DEFENDER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ATTACKER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FBV';
const ONLINE_COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FCV';

class StoreNotifierPort extends NotifierPort {
  constructor(private readonly inner: MockNotifier) {
    super();
  }
  send(n: Notification): Promise<NotificationResult> {
    return this.inner.send(n);
  }
}

async function createIntegratedPipeline(foundingSeatsPerSector = 4) {
  const bus = new EventBus();
  const lobbyStore = new MemoryLobbyStore();
  const persistence = new LobbyPersistenceService(undefined, undefined, lobbyStore);
  const lifecycle = new WorldLifecycleService(persistence);
  const reservations = new SectorReservationService(persistence, lifecycle);
  const homeRepo = new HomeRepository();
  const spawnSaga = new SpawnSagaService(persistence, reservations, homeRepo, lifecycle);
  const provisioning = new CanonicalWorldProvisioningService(persistence, lifecycle, homeRepo);
  const reconciliation = new WorldReconciliationService(
    persistence,
    lifecycle,
    reservations,
    spawnSaga,
    provisioning,
    homeRepo,
    undefined,
    bus,
  );
  await provisioning.provisionAllCanonicalWorlds({ foundingSeatsPerSector });

  const digestStore = new MemoryDigestStore();
  let nowMs = Date.parse('2026-11-10T12:00:00.000Z');
  const digests = new AwayDigestService({
    store: digestStore,
    now: () => new Date(nowMs),
  });
  const unsubDigest = attachAwayDigest(bus, digests);

  const notifyStore = new InMemoryMockNotifyStore();
  const presence = new ColonyPresenceRegistry();
  const mockNotifier = new MockNotifier(notifyStore, presence);
  const alertRouter = new AlertRouter(new StoreNotifierPort(mockNotifier), bus);
  alertRouter.onModuleInit();

  const listeners = new Set<(planetId: string, events: readonly SimEvent[]) => void>();
  const fakePlanets = {
    onEvents(cb: (planetId: string, events: readonly SimEvent[]) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  } as unknown as GamePlanets;

  const unsubBridge = bridgePlanetEvents(fakePlanets, bus, undefined, undefined, reconciliation);

  const emitFromSim = async (events: readonly SimEvent[]) => {
    for (const cb of listeners) cb(PLANET, events);
    await new Promise((resolve) => setImmediate(resolve));
  };

  return {
    bus,
    persistence,
    reservations,
    homeRepo,
    spawnSaga,
    reconciliation,
    digestStore,
    digests,
    notifyStore,
    presence,
    emitFromSim,
    advanceMs: (deltaMs: number) => {
      nowMs += deltaMs;
    },
    now: () => new Date(nowMs),
    dispose: () => {
      unsubBridge();
      unsubDigest();
      alertRouter.onModuleDestroy();
    },
  };
}

async function seatColonyInSector(
  pipeline: Awaited<ReturnType<typeof createIntegratedPipeline>>,
  playerId: string,
  colonyId: string,
) {
  const { ticket } = await pipeline.persistence.enqueueTicket({
    playerId,
    colonyId,
    request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' },
  });
  const reserved = await pipeline.reservations.reserveSlotForTicket(ticket);
  if (!reserved.ok) throw new Error(`failed to reserve slot for ${colonyId}`);
  const spawned = await pipeline.spawnSaga.executeSpawnForReservation(reserved.reservation);
  expect(spawned.ok).toBe(true);
  return reserved.reservation;
}

describe('W18-33 integration — bus-bridge -> AwayDigestService + WorldReconciliationService + AlertRouter', () => {
  it('folds away PvP raid into target digest, routes alerts, and releases eliminated colony sector seat', async () => {
    const pipe = await createIntegratedPipeline(4);
    const attackerRes = await seatColonyInSector(pipe, 'pr_attacker', ATTACKER);
    const defenderRes = await seatColonyInSector(pipe, 'pr_defender', DEFENDER);

    const beforeSnap = await pipe.reconciliation.reconcileWorld('desert');
    const beforeSec = beforeSnap.sectors.find((s) => s.sectorId === 'sec_0_0')!;
    expect(beforeSec).toMatchObject({ foundedSeats: 2, livingColonies: 2, freeSeats: 2 });

    await pipe.emitFromSim([
      {
        kind: 'colonyAway',
        severity: 'info',
        atTick: 1,
        colonyIds: [DEFENDER],
        data: { colonyId: DEFENDER, atTick: 1 },
      },
      {
        kind: 'raidStarted',
        severity: 'warn',
        atTick: 10,
        colonyIds: [ATTACKER, DEFENDER],
        data: {
          attackerColonyId: ATTACKER,
          targetColonyId: DEFENDER,
          attackerName: 'Crimson Pact',
          raidId: 'raid_10',
          q: 4,
          r: -1,
        },
      },
      {
        kind: 'raidRepelled',
        severity: 'info',
        atTick: 20,
        colonyIds: [ATTACKER, DEFENDER],
        data: {
          attackerColonyId: ATTACKER,
          targetColonyId: DEFENDER,
          attackerName: 'Crimson Pact',
          raidId: 'raid_10',
          unbreached: true,
          q: 4,
          r: -1,
        },
      },
      {
        kind: 'colonyCritical',
        severity: 'critical',
        atTick: 30,
        colonyIds: [DEFENDER],
        data: { colonyId: DEFENDER, cause: 'raid', atTick: 30, deadlineTick: 630, timerS: 600 },
      },
      {
        kind: 'colonyEliminated',
        severity: 'critical',
        atTick: 40,
        colonyIds: [DEFENDER],
        data: { colonyId: DEFENDER, cause: 'raid', atTick: 40 },
      },
    ]);

    pipe.advanceMs(300_000);
    const closedDigest = await pipe.digests.deliverWelcome(DEFENDER, pipe.now());
    expect(closedDigest).not.toBeNull();
    expect(closedDigest?.attacks.count).toBe(1);
    expect(closedDigest?.attacks.repelled).toBe(1);
    expect(closedDigest?.attacks.byColony).toContainEqual({
      displayName: 'Crimson Pact',
      count: 1,
    });

    const defUpdatedRes = await pipe.reservations.getReservationById(defenderRes.reservationId);
    const attUpdatedRes = await pipe.reservations.getReservationById(attackerRes.reservationId);
    expect(defUpdatedRes?.state).toBe('RELEASED');
    expect(attUpdatedRes?.state).toBe('COMMITTED');
    expect((await pipe.homeRepo.findColonyById(DEFENDER))?.status).toBe('ELIMINATED');
    expect((await pipe.homeRepo.findColonyById(ATTACKER))?.status).toBe('ACTIVE');

    const afterSnap = await pipe.reconciliation.reconcileWorld('desert');
    const afterSec = afterSnap.sectors.find((s) => s.sectorId === 'sec_0_0')!;
    expect(afterSec).toMatchObject({
      foundedSeats: 1,
      livingColonies: 1,
      eliminatedColonies: 1,
      freeSeats: 3,
    });
    expect(pipe.notifyStore.list(DEFENDER).map((n) => n.kind)).toEqual([
      'under_attack',
      'colony_critical',
      'colony_eliminated',
    ]);
    pipe.dispose();
  });
});

describe('W18-33 integration — negative & boundary cases', () => {
  it('keeps attacker digest clean, ignores online colonies, and handles duplicate colonyEliminated idempotently', async () => {
    const pipe = await createIntegratedPipeline(4);
    const attackerRes = await seatColonyInSector(pipe, 'pr_attacker', ATTACKER);
    const defenderRes = await seatColonyInSector(pipe, 'pr_defender', DEFENDER);

    await pipe.emitFromSim([
      {
        kind: 'colonyAway',
        severity: 'info',
        atTick: 1,
        colonyIds: [ATTACKER],
        data: { colonyId: ATTACKER, atTick: 1 },
      },
      {
        kind: 'raidStarted',
        severity: 'warn',
        atTick: 5,
        colonyIds: [ATTACKER, ONLINE_COLONY],
        data: {
          attackerColonyId: ATTACKER,
          targetColonyId: ONLINE_COLONY,
          q: 0,
          r: 0,
        },
      },
    ]);
    await pipe.digests.flushPlanet(PLANET);
    expect((await pipe.digestStore.findOpen(ATTACKER))?.body.attacks.count).toBe(0);
    expect(await pipe.digestStore.findOpen(ONLINE_COLONY)).toBeNull();

    await pipe.emitFromSim([
      {
        kind: 'colonyAway',
        severity: 'info',
        atTick: 10,
        colonyIds: [DEFENDER],
        data: { colonyId: DEFENDER, atTick: 10 },
      },
      ...Array.from({ length: DIGEST_LIST_CAP + 3 }, (_, idx) => ({
        kind: 'raidStarted' as const,
        severity: 'warn' as const,
        atTick: 11 + idx,
        colonyIds: [ATTACKER, DEFENDER],
        data: {
          attackerColonyId: idx === 0 ? undefined : ATTACKER,
          targetColonyId: DEFENDER,
          ...(idx >= 2 ? { attackerName: `Wave-${idx}` } : {}),
          q: 1,
          r: 1,
        },
      })),
      {
        kind: 'colonyEliminated',
        severity: 'critical',
        atTick: 60,
        colonyIds: [DEFENDER],
        data: { colonyId: DEFENDER, cause: 'raid', atTick: 60 },
      },
      {
        kind: 'colonyEliminated',
        severity: 'critical',
        atTick: 61,
        colonyIds: [DEFENDER],
        data: { colonyId: DEFENDER, cause: 'raid', atTick: 61 },
      },
    ]);

    await pipe.reconciliation.handlePlanetEvent('colonyEliminated', PLANET, {
      colonyIds: [DEFENDER],
    });
    const closed = await pipe.digests.deliverWelcome(DEFENDER, pipe.now());
    expect(closed?.attacks.count).toBe(DIGEST_LIST_CAP + 3);
    expect(closed?.attacks.byColony).toHaveLength(DIGEST_LIST_CAP);
    expect(closed?.attacks.byColony[0]?.displayName).toBe('hostile');
    expect(closed?.attacks.byColony[1]?.displayName).toBe(ATTACKER);
    expect(closed?.attacks.byColony[2]?.displayName).toBe('Wave-2');

    expect((await pipe.reservations.getReservationById(defenderRes.reservationId))?.state).toBe(
      'RELEASED',
    );
    expect((await pipe.reservations.getReservationById(attackerRes.reservationId))?.state).toBe(
      'COMMITTED',
    );
    const snap = await pipe.reconciliation.reconcileWorld('desert');
    const sec = snap.sectors.find((s) => s.sectorId === 'sec_0_0')!;
    expect(sec).toMatchObject({ foundedSeats: 1, livingColonies: 1, freeSeats: 3 });
    pipe.dispose();
  });
});
