import 'reflect-metadata';
import { AwayDigestV1Schema, CANONICAL_PLANETS, DIGEST_LIST_CAP } from '@terra/contracts';
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
import { digestSignal } from './events';
import { foldAlert, foldAttack, foldLoss } from './folder';
import { MemoryDigestStore } from './memory-store';
import { AwayDigestService } from './service';
import { emptyDigest } from './body';

const PLANET = CANONICAL_PLANETS.desert.id;
const DEFENDER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ATTACKER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FBV';
const BYSTANDER = 'co_01ARZ3NDEKTSV4RRFFQ69G5FCV';

function createClock(start = Date.parse('2026-11-10T12:00:00.000Z')) {
  let nowMs = start;
  return {
    now: () => new Date(nowMs),
    advanceMs: (deltaMs: number) => {
      nowMs += deltaMs;
    },
  };
}

function createDigestHarness() {
  const store = new MemoryDigestStore();
  const clock = createClock();
  const service = new AwayDigestService({ store, now: clock.now });
  return { store, clock, service };
}

describe('W18-33 unit — PvP away digest positive folding', () => {
  it('folds PvP raidStarted and raidRepelled into target colony digest with attacker displayName', async () => {
    const { store, clock, service } = createDigestHarness();

    await service.onPlanetEvent({
      planetId: PLANET,
      tick: 1,
      kind: 'colonyAway',
      colonyIds: [DEFENDER],
      data: { colonyId: DEFENDER, atTick: 1 },
    });
    await service.onPlanetEvent({
      planetId: PLANET,
      tick: 10,
      kind: 'raidStarted',
      colonyIds: [ATTACKER, DEFENDER],
      data: {
        attackerColonyId: ATTACKER,
        targetColonyId: DEFENDER,
        attackerName: 'Crimson Pact',
        raidId: 'raid_10',
        q: 3,
        r: -2,
      },
    });
    await service.onPlanetEvent({
      planetId: PLANET,
      tick: 25,
      kind: 'raidRepelled',
      colonyIds: [ATTACKER, DEFENDER],
      data: {
        attackerColonyId: ATTACKER,
        targetColonyId: DEFENDER,
        attackerName: 'Crimson Pact',
        raidId: 'raid_10',
        unbreached: false,
        q: 3,
        r: -2,
      },
    });
    await service.onPlanetEvent({
      planetId: PLANET,
      tick: 30,
      kind: 'buildingDestroyed',
      colonyIds: [DEFENDER],
      data: {
        colonyId: DEFENDER,
        entityId: 42,
        building: 'turret',
        tier: 1,
        cause: 'raid',
        q: 3,
        r: -2,
      },
    });
    await service.onPlanetEvent({
      planetId: PLANET,
      tick: 35,
      kind: 'colonyCritical',
      colonyIds: [DEFENDER],
      data: { colonyId: DEFENDER, cause: 'raid', deadlineTick: 635, timerS: 600 },
    });

    clock.advanceMs(180_000);
    await service.onPlanetEvent({
      planetId: PLANET,
      tick: 50,
      kind: 'colonyBack',
      colonyIds: [DEFENDER],
      data: { colonyId: DEFENDER, atTick: 50 },
    });

    const unseen = await store.listUnseen(DEFENDER);
    expect(unseen).toHaveLength(1);
    const body = unseen[0]!.body;
    expect(AwayDigestV1Schema.safeParse(body).success).toBe(true);
    expect(body.attacks.count).toBe(1);
    expect(body.attacks.repelled).toBe(1);
    expect(body.attacks.byColony).toContainEqual({ displayName: 'Crimson Pact', count: 1 });
    expect(body.lost).toEqual([{ kind: 'turret', tier: 1, count: 1, cause: 'raid' }]);
    expect(body.alerts).toContainEqual({
      code: 'under_attack',
      message: 'Colony critical (raid)',
    });
  });
});

describe('W18-33 unit — PvP colony elimination seat release', () => {
  it('eliminates colony via WorldReconciliationService and releases its sector seat', async () => {
    const store = new MemoryLobbyStore();
    const persistence = new LobbyPersistenceService(undefined, undefined, store);
    const lifecycle = new WorldLifecycleService(persistence);
    const reservations = new SectorReservationService(persistence, lifecycle);
    const homeRepo = new HomeRepository();
    const spawnSaga = new SpawnSagaService(persistence, reservations, homeRepo, lifecycle);
    const provisioning = new CanonicalWorldProvisioningService(persistence, lifecycle, homeRepo);
    const bus = new EventBus();
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
    await provisioning.provisionAllCanonicalWorlds({ foundingSeatsPerSector: 4 });

    const { ticket: tkDef } = await persistence.enqueueTicket({
      playerId: 'pr_def',
      colonyId: DEFENDER,
      request: { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' },
    });
    const resDef = await reservations.reserveSlotForTicket(tkDef);
    if (!resDef.ok) throw new Error('expected defender reservation');
    await spawnSaga.executeSpawnForReservation(resDef.reservation);

    const out = await reconciliation.eliminateColony(DEFENDER, { planetId: PLANET });
    expect(out.status).toBe('ELIMINATED');
    expect(out.reservationReleased).toBe(true);
    expect(out.reservationState).toBe('RELEASED');
    expect(out.sectorLivingColonies).toBe(0);
    expect(out.sectorFreeSeats).toBe(4);
    expect((await reservations.getReservationById(resDef.reservation.reservationId))?.state).toBe(
      'RELEASED',
    );
  });
});

describe('W18-33 unit — negative cases (attacker isolation & online suppression)', () => {
  it('does not fold an incoming attack into the attacker colony digest and ignores online colonies', async () => {
    const { store, service } = createDigestHarness();

    await service.onPlanetEvent({
      planetId: PLANET,
      tick: 1,
      kind: 'colonyAway',
      colonyIds: [ATTACKER],
      data: { colonyId: ATTACKER, atTick: 1 },
    });

    await service.onPlanetEvent({
      planetId: PLANET,
      tick: 10,
      kind: 'raidStarted',
      colonyIds: [ATTACKER, DEFENDER],
      data: {
        attackerColonyId: ATTACKER,
        targetColonyId: DEFENDER,
        attackerName: 'Crimson Pact',
        q: 1,
        r: 1,
      },
    });
    await service.flushPlanet(PLANET);

    const attackerOpen = await store.findOpen(ATTACKER);
    expect(attackerOpen?.body.attacks.count).toBe(0);
    expect(attackerOpen?.body.attacks.byColony).toEqual([]);
    expect(await store.findOpen(DEFENDER)).toBeNull();
    expect(await store.findOpen(BYSTANDER)).toBeNull();
  });
});

describe('W18-33 unit — corner & boundary cases (DIGEST_LIST_CAP, fallbacks, idempotency)', () => {
  it('enforces DIGEST_LIST_CAP = 20 on byColony and falls back to attackerColonyId or hostile', () => {
    let body = emptyDigest(DEFENDER, '2026-11-10T12:00:00.000Z');
    for (let i = 1; i <= 25; i++) {
      const sig = digestSignal({
        planetId: PLANET,
        tick: i,
        kind: 'raidStarted',
        colonyIds: [ATTACKER, DEFENDER],
        data: {
          attackerColonyId: ATTACKER,
          targetColonyId: DEFENDER,
          attackerName: `Raider-${i}`,
          q: 0,
          r: 0,
        },
      });
      if (sig.type === 'attack') body = foldAttack(body, sig.attack);
    }
    expect(body.attacks.count).toBe(25);
    expect(body.attacks.byColony).toHaveLength(DIGEST_LIST_CAP);
    expect(body.attacks.byColony[0]?.displayName).toBe('Raider-1');
    expect(body.attacks.byColony[19]?.displayName).toBe('Raider-20');

    const idFallbackSig = digestSignal({
      planetId: PLANET,
      tick: 30,
      kind: 'raidStarted',
      colonyIds: [ATTACKER, DEFENDER],
      data: { attackerColonyId: ATTACKER, targetColonyId: DEFENDER, q: 0, r: 0 },
    });
    expect(idFallbackSig.type).toBe('attack');
    if (idFallbackSig.type === 'attack') {
      const folded = foldAttack(emptyDigest(DEFENDER, '2026-11-10T12:00:00.000Z'), idFallbackSig.attack);
      expect(folded.attacks.byColony).toEqual([{ displayName: ATTACKER, count: 1 }]);
    }

    const hostileFallbackSig = digestSignal({
      planetId: PLANET,
      tick: 31,
      kind: 'raidStarted',
      colonyIds: [DEFENDER],
      data: { targetColonyId: DEFENDER, q: 0, r: 0 },
    });
    if (hostileFallbackSig.type === 'attack') {
      const folded = foldAttack(emptyDigest(DEFENDER, '2026-11-10T12:00:00.000Z'), hostileFallbackSig.attack);
      expect(folded.attacks.byColony).toEqual([{ displayName: 'hostile', count: 1 }]);
    }

    const withUnitLoss = foldLoss(body, {
      kind: 'unitDestroyed',
      tick: 32,
      count: 3,
      cause: 'raid',
    });
    expect(withUnitLoss.robots.lost).toBe(3);

    const withElimAlert = foldAlert(withUnitLoss, {
      kind: 'colonyEliminated',
      tick: 33,
      cause: 'raid',
    });
    expect(withElimAlert.alerts).toContainEqual({
      code: 'under_attack',
      message: 'Colony eliminated (raid)',
    });
  });
});
