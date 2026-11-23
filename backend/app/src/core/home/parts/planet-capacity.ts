import type { DevPlanetType } from '@terra/sim';
import type { HomeLandingHost } from '../home-resolve.helpers';
import type { HomeRepository, PlanetRecord } from '../home.repository';

/**
 * The planet cap (3.4) as the seat path sees it. The game module wires it (`HomeService.setCapacityGate`): `cap` from
 * `TA_PLANET_CAP`, the loaded set cluster-wide from the sim leases (an `api` process hosts none itself).
 */
export interface PlanetCapacityGate {
  /** Most planets loaded at once. */
  readonly cap: number;
  /** Planets loaded now. */
  loadedPlanetIds(): Promise<ReadonlySet<string>>;
}

/** Every loaded planet is in use and none of them has a free seat: the player waits in the lobby queue. */
export class PlanetCapReached extends Error {
  constructor(readonly type: DevPlanetType, readonly cap: number, readonly loaded: number) {
    super(`planet cap reached: ${loaded} of ${cap} planets loaded and none of type ${type} has a free seat`);
    this.name = 'PlanetCapReached';
  }
}

export interface SeatPick {
  readonly planet: PlanetRecord;
  readonly colonyIndex: number;
  /** The planet exists but is not loaded (idle-unloaded): restore it before asking for a landing site. */
  readonly wake: boolean;
}

/**
 * Where a NEW colony of `type` goes, under the cap: a loaded planet with a free seat first; below the cap an unloaded
 * one with a free seat (woken), else a new planet. At the cap with no loaded seat: {@link PlanetCapReached}.
 * Without a gate (tests, no game module): the first open planet of the family or a new one, as before.
 */
export async function pickSeatPlanet(
  repo: HomeRepository,
  gate: PlanetCapacityGate | undefined,
  type: DevPlanetType,
  skip: ReadonlySet<string>,
  skipIndices: ReadonlyMap<string, ReadonlySet<number>>,
): Promise<SeatPick> {
  if (!gate) return { ...(await repo.findOrCreateOpenDevPlanet(type, skip, skipIndices)), wake: false };
  const loaded = await gate.loadedPlanetIds();
  const open = await repo.findOpenDevPlanets(type, skip, skipIndices);
  const live = open.find((o) => loaded.has(o.planet.id));
  if (live) return { ...live, wake: false };
  if (loaded.size >= gate.cap) throw new PlanetCapReached(type, gate.cap, loaded.size);
  const [asleep] = open;
  if (asleep) return { ...asleep, wake: true };
  return { ...(await repo.createNextDevPlanet(type, skipIndices)), wake: false };
}

/** An explicitly requested planet that is not loaded is woken, which needs room under the cap. */
export async function explicitPlanetWake(gate: PlanetCapacityGate | undefined, planet: PlanetRecord, type: DevPlanetType): Promise<boolean> {
  if (!gate) return false;
  const loaded = await gate.loadedPlanetIds();
  if (loaded.has(planet.id)) return false;
  if (loaded.size >= gate.cap) throw new PlanetCapReached(type, gate.cap, loaded.size);
  return true;
}

/** Restores an idle-unloaded planet through the home-load path (snapshot restore with bounded catch-up). */
export async function wakePlanet(
  host: HomeLandingHost | undefined,
  repo: HomeRepository,
  planet: PlanetRecord,
): Promise<void> {
  await host?.ensureHomeLoaded(planet, () => repo.listColoniesByPlanetId(planet.id));
}
