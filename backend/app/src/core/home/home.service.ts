import { Inject, Injectable, Optional } from '@nestjs/common';
import { newId, type ColonySummary, type HomeResponse, type PlanetSummary, type SimCommandV1 } from '@terra/contracts';
import { DEV_PLANET_TYPE, type DevPlanetType } from '@terra/sim';
import { CoreConflict, CoreException } from '../errors';
import { type ColonyRecord, HomeRepository, type PlanetRecord } from './home.repository';

export const HOME_SEAT_NOTIFIER = Symbol('HOME_SEAT_NOTIFIER');

/** The landing site of a seat: where the planet's sim said the colony lands (`slot.index`: its spawn slot, if any). */
export interface SeatSlot {
  readonly index: number;
  readonly q: number;
  readonly r: number;
}

export interface ColonySeatAssignment {
  readonly player: { readonly id: string; readonly handle: string };
  readonly colony: ColonyRecord;
  readonly planet: PlanetRecord;
  readonly slot: SeatSlot;
}

export interface HomeSeatNotifier {
  onColonySeated(assignment: ColonySeatAssignment): void | Promise<void>;
}

export type ColonySeatListener = (assignment: ColonySeatAssignment) => void | Promise<void>;

/** Where the planet's sim would land a colony now (`nextLandingSite`), or the sim's reason why it cannot. */
export type HomeLandingSite =
  | { readonly ok: true; readonly q: number; readonly r: number; readonly slotIndex?: number }
  | { readonly ok: false; readonly code: string };

/**
 * What seating needs from the game (set by the game module, `setLandingHost`): the sim decides landing sites (LED-14)
 * and a home's planet is loaded before it is answered ACTIVE (BE-14). Both throw when the planet cannot be loaded.
 */
export interface HomeLandingHost {
  /** Loads the planet when needed and asks its sim where colony `colonyIndex` would land now. */
  landingSite(planet: PlanetRecord, colonyIndex: number): Promise<HomeLandingSite>;
  /**
   * Loads an existing home's planet when it is not loaded: restored from its snapshot, or (no snapshot at all) generated
   * fresh with the planet's live `colonies` landed again at their recorded sites.
   */
  ensureHomeLoaded(planet: PlanetRecord, colonies: () => Promise<ColonyRecord[]>): Promise<void>;
}

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
      slotIndex: slot.index,
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

/** Landing attempts per `getOrAssignHome` (each asks a planet's sim for a site, seats there or moves on). */
export const SEAT_ATTEMPTS = 8;
/** Planets tried per `getOrAssignHome`: one whose sim has no landing site left is marked and the next of its family tried. */
export const SEAT_PLANETS = 2;

/**
 * Sim codes that mean the planet takes no further colony: no free landing site, or the sim's colony limit
 * (`planet_full`, `MAX_COLONIES_PER_PLANET`). The planet is never offered again and the next of its family is tried.
 */
const NO_SITE_CODES: readonly string[] = ['landing_site_taken', 'planet_full'];

/** Why one landing attempt did not seat: no site left on the planet, the colony index already landed there, or try again. */
type SeatMiss = 'no_site' | 'index_landed' | 'retry';

/** The sim refused the landing with `code` (`COLONY_SEAT_REJECTED` with `details.code === code`). */
function isSeatRejected(e: unknown, code: string): boolean {
  if (!(e instanceof CoreException) || e.errorCode !== 'COLONY_SEAT_REJECTED') return false;
  return (e.details as { code?: unknown } | undefined)?.code === code;
}

/** No landing site left on the planets tried (their sims said so). */
function noLandingSite(planetIds: readonly string[]): CoreConflict {
  return new CoreConflict('COLONY_SEAT_REJECTED', {
    message: `no landing site left on ${planetIds.join(', ')}: their sims have no free landing site`,
    details: { code: 'landing_site_taken', planetIds },
  });
}

function hostUnavailable(planetId: string, message: string, cause?: string): CoreConflict {
  return new CoreConflict('COLONY_SEAT_REJECTED', { message, details: { code: 'host_unavailable', planetId, ...(cause ? { cause } : {}) } });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

@Injectable()
export class HomeService {
  /** Planets whose sim has no landing site left: `findOrCreateOpenDevPlanet` moves on to the next of the family. */
  private readonly exhausted = new Set<string>();
  /** Colony indices the sim already landed (a landing acked after its seat timed out, LED-15), per planet. */
  private readonly landedIndices = new Map<string, Set<number>>();
  private readonly seatListeners = new Set<ColonySeatListener>();
  private landingHost: HomeLandingHost | undefined;
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

  /** The game module plugs its sims in here; without a host no colony can be seated (`host_unavailable`). */
  setLandingHost(host: HomeLandingHost | undefined): void {
    this.landingHost = host;
  }

  async setColonyStatus(colonyId: string, status: string): Promise<ColonyRecord | null> {
    return this.repo.setColonyStatus(colonyId, status);
  }

  async setPlanetStatus(planetId: string, status: string): Promise<PlanetRecord | null> {
    return this.repo.setPlanetStatus(planetId, status);
  }

  async getExistingHome(playerId: string): Promise<HomeResponse | null> {
    const found = await this.existingColony(playerId);
    return found && this.buildHomeResponse(found.colony, found.planet);
  }

  private async existingColony(playerId: string): Promise<{ colony: ColonyRecord; planet: PlanetRecord } | null> {
    const colony = await this.repo.findLatestColonyByPlayerId(playerId);
    if (!colony) return null;
    const planet = (await this.repo.findPlanetById(colony.planetId)) ?? (await this.repo.upsertDevPlanet(colony.planetId));
    return { colony, planet };
  }

  /**
   * The player's home; a NEW colony is seated on a dev planet of `preferredType` (the orbit pick, one dev planet
   * family per type) or `DEV_PLANET_TYPE`. An existing colony keeps its planet whatever the preference; an ACTIVE one
   * has its planet loaded first (BE-14), and a planet that cannot be loaded answers 503 `HOME_UNAVAILABLE`.
   */
  async getOrAssignHome(player: { id: string; handle?: string }, preferredType?: DevPlanetType): Promise<HomeResponse> {
    const existing = await this.existingColony(player.id);
    if (existing) return this.answerExisting(existing.colony, existing.planet);

    return this.withSeatLock(async () => {
      const recheck = await this.existingColony(player.id);
      if (recheck) return this.answerExisting(recheck.colony, recheck.planet);
      return this.seatNew({ id: player.id, handle: player.handle?.trim() || `Colonist-${player.id.slice(-4)}` }, preferredType ?? DEV_PLANET_TYPE);
    });
  }

  private async answerExisting(colony: ColonyRecord, planet: PlanetRecord): Promise<HomeResponse> {
    const home = this.buildHomeResponse(colony, planet);
    if (home.state !== 'ACTIVE' || !this.landingHost) return home;
    try {
      await this.landingHost.ensureHomeLoaded(planet, () => this.repo.listColoniesByPlanetId(planet.id));
    } catch (e) {
      throw new CoreException('HOME_UNAVAILABLE', { status: 503, message: `home planet ${planet.id} cannot be loaded: ${errText(e)}`, details: { planetId: planet.id } });
    }
    return home;
  }

  /**
   * Seats a new colony: up to {@link SEAT_ATTEMPTS} landings on at most {@link SEAT_PLANETS} planets. Each attempt asks
   * the planet's sim for the next landing site (LED-14), writes the colony row there and lands it. A planet whose sim has
   * no site left is never offered again; a colony index the sim already landed is skipped on that planet.
   */
  private async seatNew(player: { id: string; handle: string }, type: DevPlanetType): Promise<HomeResponse> {
    const tried: string[] = [];
    for (let attempt = 0; attempt < SEAT_ATTEMPTS; attempt++) {
      const { planet, colonyIndex } = await this.repo.findOrCreateOpenDevPlanet(type, this.exhausted, this.landedIndices);
      if (!tried.includes(planet.id)) {
        if (tried.length >= SEAT_PLANETS) break;
        tried.push(planet.id);
      }
      const out = await this.seatOnPlanet(player, planet, colonyIndex);
      if (typeof out === 'object') return out;
      if (out === 'no_site') this.exhausted.add(planet.id);
      else if (out === 'index_landed') this.markLanded(planet.id, colonyIndex);
    }
    throw noLandingSite(tried);
  }

  private async seatOnPlanet(player: { id: string; handle: string }, openPlanet: PlanetRecord, colonyIndex: number): Promise<HomeResponse | SeatMiss> {
    const site = await this.askLandingSite(openPlanet, colonyIndex);
    if (!site.ok) {
      if (site.code === 'already_landed') return 'index_landed';
      if (NO_SITE_CODES.includes(site.code)) return 'no_site';
      throw hostUnavailable(openPlanet.id, `planet ${openPlanet.id} has no landing site for colony ${colonyIndex}: ${site.code}`, site.code);
    }
    const { colony, planet } = await this.repo.createColony({
      playerId: player.id, planetId: openPlanet.id, colonyIndex, name: `${player.handle.slice(0, 22)}'s Colony`, color: colonyIndex,
      status: 'ACTIVE', spawnQ: site.q, spawnR: site.r,
    });
    try {
      await this.notifySeated({ player, colony, planet, slot: { index: site.slotIndex ?? colonyIndex, q: site.q, r: site.r } });
      return this.buildHomeResponse(colony, planet);
    } catch (e) {
      if (isSeatRejected(e, 'already_landed')) return 'index_landed';
      if (isSeatRejected(e, 'landing_site_taken')) return 'retry'; // the site went between the question and the landing
      if (isSeatRejected(e, 'planet_full')) return 'no_site'; // the sim seats no more colonies there
      throw e; // the row is rolled back
    }
  }

  private async askLandingSite(planet: PlanetRecord, colonyIndex: number): Promise<HomeLandingSite> {
    if (!this.landingHost) throw hostUnavailable(planet.id, `no game host to land a colony on ${planet.id}`);
    try {
      return await this.landingHost.landingSite(planet, colonyIndex);
    } catch (e) {
      throw hostUnavailable(planet.id, `planet ${planet.id} cannot be asked for a landing site: ${errText(e)}`);
    }
  }

  private markLanded(planetId: string, colonyIndex: number): void {
    let set = this.landedIndices.get(planetId);
    if (!set) this.landedIndices.set(planetId, (set = new Set()));
    set.add(colonyIndex);
  }

  /**
   * The sim landed a colony after its seat timed out and the row was rolled back (LED-15). When the player still has no
   * colony, the row is written again (same id, index and site), so the next `/me/home` answers that colony; otherwise
   * the colony index is marked landed so no later seat is offered it. Returns whether the row was restored.
   */
  adoptLateLanding(assignment: ColonySeatAssignment): Promise<boolean> {
    return this.withSeatLock(async () => {
      const { player, colony } = assignment;
      if (await this.repo.findLatestColonyByPlayerId(player.id)) {
        this.markLanded(colony.planetId, colony.colonyIndex);
        return false;
      }
      await this.repo.createColony({ ...colony });
      return true;
    });
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

  private withSeatLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.seatChain.then(fn, fn);
    this.seatChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
