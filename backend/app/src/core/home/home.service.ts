import { Inject, Injectable, Optional } from '@nestjs/common';
import { newId, type ColonySummary, type HomeResponse, type PlanetSummary, type SimCommandV1 } from '@terra/contracts';
import { createPlanet, getSpawnSlots, type SpawnSlot } from '@terra/sim';
import {
  type ColonyRecord,
  DEV_PLANET_CAPACITY,
  DEV_PLANET_RADIUS,
  DEV_PLANET_SEED,
  DEV_PLANET_TYPE,
  HomeRepository,
  type PlanetRecord,
} from './home.repository';

export const HOME_SEAT_NOTIFIER = Symbol('HOME_SEAT_NOTIFIER');

export interface ColonySeatAssignment {
  readonly player: { readonly id: string; readonly handle: string };
  readonly colony: ColonyRecord;
  readonly planet: PlanetRecord;
  readonly slot: SpawnSlot;
}

export interface HomeSeatNotifier {
  onColonySeated(assignment: ColonySeatAssignment): void | Promise<void>;
}

export type ColonySeatListener = (assignment: ColonySeatAssignment) => void | Promise<void>;

export function createSpawnColonyCommand(assignment: ColonySeatAssignment): SimCommandV1 {
  const { player, colony, slot } = assignment;
  return {
    colonyIndex: colony.colonyIndex,
    source: 'system',
    commandId: newId('cm'),
    kind: 'system.spawnColony',
    args: {
      colonyId: colony.id,
      colonyIndex: colony.colonyIndex,
      playerId: player.id,
      handle: player.handle,
      name: colony.name,
      color: colony.color,
      slotIndex: slot.index ?? colony.colonyIndex,
      q: colony.spawnQ,
      r: colony.spawnR,
    },
  };
}

export function toColonySummary(colony: ColonyRecord): ColonySummary {
  return {
    id: colony.id,
    playerId: colony.playerId,
    planetId: colony.planetId,
    colonyIndex: colony.colonyIndex,
    name: colony.name,
    color: colony.color,
    state: colony.status,
    status: colony.status,
    spawnQ: colony.spawnQ,
    spawnR: colony.spawnR,
  };
}

export function toPlanetSummary(planet: PlanetRecord): PlanetSummary {
  return {
    id: planet.id,
    name: planet.name,
    type: planet.type,
    seed: planet.seed,
    radius: planet.radius,
    state: planet.status,
    status: planet.status,
    capacity: planet.capacity,
    seatsTaken: planet.seatsTaken,
    seats: {
      taken: planet.seatsTaken,
      capacity: planet.capacity,
    },
  };
}

@Injectable()
export class HomeService {
  private readonly slotCache = new Map<string, SpawnSlot[]>();
  private readonly seatListeners = new Set<ColonySeatListener>();
  private seatChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly repo: HomeRepository,
    @Optional() @Inject(HOME_SEAT_NOTIFIER) private readonly notifier?: HomeSeatNotifier,
  ) {}

  onColonySeated(listener: ColonySeatListener): () => void {
    this.seatListeners.add(listener);
    return () => {
      this.seatListeners.delete(listener);
    };
  }

  async setColonyStatus(colonyId: string, status: string): Promise<ColonyRecord | null> {
    return this.repo.setColonyStatus(colonyId, status);
  }

  async setPlanetStatus(planetId: string, status: string): Promise<PlanetRecord | null> {
    return this.repo.setPlanetStatus(planetId, status);
  }

  async getExistingHome(playerId: string): Promise<HomeResponse | null> {
    const colony = await this.repo.findLatestColonyByPlayerId(playerId);
    if (!colony) return null;

    const planet =
      (await this.repo.findPlanetById(colony.planetId)) ??
      (await this.repo.upsertDevPlanet(colony.planetId));

    return this.buildHomeResponse(colony, planet);
  }

  async getOrAssignHome(player: { id: string; handle?: string }): Promise<HomeResponse> {
    const existing = await this.getExistingHome(player.id);
    if (existing) return existing;

    return this.withSeatLock(async () => {
      const recheck = await this.getExistingHome(player.id);
      if (recheck) return recheck;

      const handle = player.handle?.trim() || `Colonist-${player.id.slice(-4)}`;
      const { planet: openPlanet, colonyIndex } = await this.repo.findOrCreateOpenDevPlanet();
      const slots = this.getSpawnSlotsForPlanet(openPlanet);
      const existingColonies = await this.repo.listColoniesByPlanetId(openPlanet.id);
      const takenCoords = new Set(existingColonies.map((c) => `${c.spawnQ},${c.spawnR}`));
      const preferred = slots[colonyIndex];
      const slot =
        (preferred && !takenCoords.has(`${preferred.q},${preferred.r}`) ? preferred : undefined) ??
        slots.find((s) => !takenCoords.has(`${s.q},${s.r}`)) ??
        preferred ??
        slots[0] ??
        { index: colonyIndex, q: 0, r: 0 };
      const colonyName = `${handle.slice(0, 22)}'s Colony`;

      const { colony, planet } = await this.repo.createColony({
        playerId: player.id,
        planetId: openPlanet.id,
        colonyIndex,
        name: colonyName,
        color: colonyIndex,
        status: 'ACTIVE',
        spawnQ: slot.q,
        spawnR: slot.r,
      });

      const assignment: ColonySeatAssignment = {
        player: { id: player.id, handle },
        colony,
        planet,
        slot,
      };
      if (this.notifier) {
        await this.notifier.onColonySeated(assignment);
      }
      for (const listener of this.seatListeners) {
        await listener(assignment);
      }

      return this.buildHomeResponse(colony, planet);
    });
  }

  private buildHomeResponse(colony: ColonyRecord, planet: PlanetRecord): HomeResponse {
    const colonySummary = toColonySummary(colony);
    const planetSummary = toPlanetSummary(planet);

    if (
      planet.status === 'ENDED' ||
      planet.status === 'PLANET_ENDED' ||
      planet.state === 'ENDED' ||
      planet.state === 'PLANET_ENDED'
    ) {
      return {
        state: 'PLANET_ENDED',
        colony: colonySummary,
        planet: planetSummary,
        results: { planetId: planet.id, colonyId: colony.id },
        planets: [],
        newPlanetTypes: [DEV_PLANET_TYPE],
      };
    }

    if (colony.status === 'ELIMINATED' || colony.state === 'ELIMINATED') {
      return {
        state: 'ELIMINATED',
        colony: colonySummary,
        planet: planetSummary,
        recap: { colonyId: colony.id, planetId: planet.id },
        planets: [],
        newPlanetTypes: [DEV_PLANET_TYPE],
      };
    }

    return {
      state: 'ACTIVE',
      colony: colonySummary,
      planet: planetSummary,
    };
  }

  private getSpawnSlotsForPlanet(planet: PlanetRecord): SpawnSlot[] {
    const key = `${planet.id}:${planet.seed}:${planet.radius}:${planet.capacity}`;
    const cached = this.slotCache.get(key);
    if (cached) return cached;

    const simState = createPlanet({
      id: planet.id,
      planetId: planet.id,
      type: planet.type ?? DEV_PLANET_TYPE,
      planetType: planet.type ?? DEV_PLANET_TYPE,
      seed: planet.seed ?? DEV_PLANET_SEED,
      radius: planet.radius ?? DEV_PLANET_RADIUS,
      capacity: planet.capacity ?? DEV_PLANET_CAPACITY,
    });
    const slots = getSpawnSlots(simState);
    this.slotCache.set(key, slots);
    return slots;
  }

  private withSeatLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.seatChain.then(fn, fn);
    this.seatChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
