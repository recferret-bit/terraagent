import { Inject, Injectable, Optional } from '@nestjs/common';
import { newId, type ColonySummary, type HomeResponse, type PlanetSummary, type SimCommandV1 } from '@terra/contracts';
import { createPlanet, getSpawnSlots, hexDistance, minLandingSeparation, type DevPlanetType, type SpawnSlot } from '@terra/sim';
import { CoreConflict, CoreException } from '../errors';
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

/** Landing attempts per planet per `getOrAssignHome`, each on another candidate slot (fewer when fewer are left). */
export const SEAT_ATTEMPTS = 8;
/** Planets tried per `getOrAssignHome`: one found without a landing site left is marked and the next of its family tried. */
export const SEAT_PLANETS = 2;

let separation: number | undefined;
/** The sim planner's `minLandingSeparation` (hex distance between landings), read once. */
const landingSeparation = () => (separation ??= minLandingSeparation());

/** Key of a landing site in a refused set. */
export const siteKey = (s: { readonly q: number; readonly r: number }) => `${s.q},${s.r}`;

/**
 * The spawn slot for a new colony: its preferred slot (`slots[colonyIndex]`) when free, else the first free one. A slot
 * is free when the sim did not refuse it before (`refused`, by {@link siteKey}) and it keeps the landing planner's
 * separation from every colony already on the planet (`landed`): a cheap subset of `landingBlock`, from the colony
 * rows (the sim still decides). With `fallback`, a planet without a free slot still gets a site the sim has not
 * refused (the preferred, the first, or the centre) and the sim answers; without it, or with every site refused,
 * `undefined`.
 */
export function pickSpawnSlot(
  slots: readonly SpawnSlot[], colonyIndex: number, landed: readonly { q: number; r: number }[], fallback: boolean, refused: ReadonlySet<string> = new Set(),
): SpawnSlot | undefined {
  const sep = Math.max(1, landingSeparation()); // ≥ 1: never the very tile of another landing
  const open = (s: SpawnSlot | undefined): s is SpawnSlot => s !== undefined && !refused.has(siteKey(s));
  const free = (s: SpawnSlot) => open(s) && landed.every((l) => hexDistance(l.q, l.r, s.q, s.r) >= sep);
  const preferred = slots[colonyIndex];
  const pick = (preferred && free(preferred) ? preferred : undefined) ?? slots.find(free);
  if (pick || !fallback) return pick;
  const centre: SpawnSlot = { index: colonyIndex, q: 0, r: 0 };
  return [preferred, ...slots, ...(slots.length === 0 ? [centre] : [])].find(open);
}

/** The sim refused the landing site (`COLONY_SEAT_REJECTED` with `details.code === 'landing_site_taken'`). */
function isLandingSiteTaken(e: unknown): boolean {
  if (!(e instanceof CoreException) || e.errorCode !== 'COLONY_SEAT_REJECTED') return false;
  return (e.details as { code?: unknown } | undefined)?.code === 'landing_site_taken';
}

/** No landing site left on the planets tried (each refused by the sim, or too close to a colony). */
function noLandingSite(planetIds: readonly string[]): CoreConflict {
  return new CoreConflict('COLONY_SEAT_REJECTED', {
    message: `no landing site left on ${planetIds.join(', ')}: every candidate slot was refused by the sim or is too close to a colony`,
    details: { code: 'landing_site_taken', planetIds },
  });
}

@Injectable()
export class HomeService {
  private readonly slotCache = new Map<string, SpawnSlot[]>();
  /** Sites the sim refused (`landing_site_taken`), per planet. In memory: the sim's landing history makes them permanent. */
  private readonly refused = new Map<string, Set<string>>();
  /** Planets without a landing site left: `findOrCreateOpenDevPlanet` moves on to the next of the family. */
  private readonly exhausted = new Set<string>();
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

  /**
   * The player's home; a NEW colony is seated on a dev planet of `preferredType` (the orbit pick, one dev planet
   * family per type) or `DEV_PLANET_TYPE`. An existing colony keeps its planet whatever the preference.
   */
  async getOrAssignHome(player: { id: string; handle?: string }, preferredType?: DevPlanetType): Promise<HomeResponse> {
    const existing = await this.getExistingHome(player.id);
    if (existing) return existing;

    return this.withSeatLock(async () => {
      const recheck = await this.getExistingHome(player.id);
      if (recheck) return recheck;

      const seated = { id: player.id, handle: player.handle?.trim() || `Colonist-${player.id.slice(-4)}` };
      const type = preferredType ?? DEV_PLANET_TYPE;
      const tried: string[] = [];
      for (let n = 0; n < SEAT_PLANETS; n++) {
        const { planet, colonyIndex } = await this.repo.findOrCreateOpenDevPlanet(type, this.exhausted);
        tried.push(planet.id);
        const home = await this.seatOnPlanet(seated, planet, colonyIndex);
        if (home) return home;
        this.exhausted.add(planet.id); // landing history makes the refusals permanent: never offer this planet again
      }
      throw noLandingSite(tried);
    });
  }

  /**
   * Seats `player` on `planet`: tries candidate slots (at most {@link SEAT_ATTEMPTS}) until the sim accepts one; a
   * slot the sim refuses (`landing_site_taken`: it knows more than the colony rows — landing history, other colonies'
   * structures, terrain) is remembered for the planet and never offered again. Undefined when no candidate is left;
   * any other reject (and the last refusal once the attempts are used up) propagates.
   */
  private async seatOnPlanet(player: { id: string; handle: string }, openPlanet: PlanetRecord, colonyIndex: number): Promise<HomeResponse | undefined> {
    const slots = this.getSpawnSlotsForPlanet(openPlanet);
    const landed = (await this.repo.listColoniesByPlanetId(openPlanet.id)).map((c) => ({ q: c.spawnQ, r: c.spawnR }));
    const refused = this.refusedSites(openPlanet.id);
    for (let attempt = 1; ; attempt++) {
      const slot = pickSpawnSlot(slots, colonyIndex, landed, attempt === 1, refused);
      if (!slot) return undefined;
      const { colony, planet } = await this.repo.createColony({
        playerId: player.id,
        planetId: openPlanet.id,
        colonyIndex,
        name: `${player.handle.slice(0, 22)}'s Colony`,
        color: colonyIndex,
        status: 'ACTIVE',
        spawnQ: slot.q,
        spawnR: slot.r,
      });
      try {
        await this.notifySeated({ player, colony, planet, slot });
        return this.buildHomeResponse(colony, planet);
      } catch (e) {
        if (!isLandingSiteTaken(e)) throw e; // the row is rolled back
        refused.add(siteKey(slot));
        if (attempt >= SEAT_ATTEMPTS) throw e;
      }
    }
  }

  private refusedSites(planetId: string): Set<string> {
    let set = this.refused.get(planetId);
    if (!set) this.refused.set(planetId, (set = new Set()));
    return set;
  }

  /**
   * Tells the notifier and listeners (the game module lands the colony in the sim). If one fails (the sim rejected the
   * landing: `COLONY_SEAT_REJECTED`), the colony row is rolled back so the player is not left with a colony that never
   * landed, and the error propagates (`/me/home` answers it instead of ACTIVE; the next call seats again).
   */
  private async notifySeated(assignment: ColonySeatAssignment): Promise<void> {
    try {
      if (this.notifier) await this.notifier.onColonySeated(assignment);
      for (const listener of this.seatListeners) await listener(assignment);
    } catch (e) {
      await this.repo.deleteColony(assignment.colony.id).catch(() => undefined); // best effort: keep the sim's error
      throw e;
    }
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
    const key = `${planet.id}:${planet.type}:${planet.seed}:${planet.radius}:${planet.capacity}`; // type: a retyped dev row
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
