import { Inject, Injectable, Optional } from '@nestjs/common';
import { canonicalPlanetById, newId, W11_DEFAULT_SECTOR_RADIUS, type PlanetType } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import {
  DEV_PLANET_CAPACITY, DEV_PLANET_RADIUS, DEV_PLANET_SEED, DEV_PLANET_TYPE, devPlanetIdFor, devPlanetTypeOf, MAX_COLONIES_PER_PLANET, type DevPlanetType,
} from '@terra/sim';
import { PRISMA } from '../../db/db.module';
import { persistenceEnabled } from '../persistence';
import { APP_ENV, type AppEnv } from '../tokens';
import { type ColonyRecord, type HomeStore, MemoryHomeStore, type PlanetRecord } from './home.store';
import { PrismaHomeStore } from './prisma-home.store';

export type { ColonyRecord, PlanetRecord } from './home.store';

export interface CreatePlanetInput {
  readonly id: string;
  readonly name?: string;
  readonly type?: PlanetType;
  readonly seed?: string;
  readonly radius?: number;
  readonly state?: string;
  readonly capacity?: number;
}

export interface CreateColonyInput {
  readonly id?: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly name: string;
  readonly color?: number;
  readonly status?: string;
  readonly foundingSectorId?: string;
  readonly landingSlotId?: string | null;
  readonly recapSeen?: boolean;
  readonly spawnQ: number;
  readonly spawnR: number;
}

function devPlanetName(type: DevPlanetType, index: number): string {
  const base = type === DEV_PLANET_TYPE ? 'Dev Planet' : `Dev Planet (${type})`;
  return index <= 1 ? base : `${base} ${index}`;
}

/** Index of a dev planet id in its type's family (`devPlanetIdFor`'s inverse), or 0 when it is not one of them. */
export function devPlanetIndexOf(type: DevPlanetType, id: string): number {
  const base = devPlanetIdFor(type, 1);
  if (id === base) return 1;
  const rest = id.startsWith(`${base}_`) ? id.slice(base.length + 1) : '';
  return /^\d+$/.test(rest) ? Number(rest) : 0;
}

const isEnded = (p: PlanetRecord) => p.status === 'ENDED' || p.status === 'PLANET_ENDED';
/** Colony indices a planet can seat: its capacity, never more than the sim lands (`MAX_COLONIES_PER_PLANET`, else `planet_full`). */
const seatsOf = (p: PlanetRecord) => Math.min(p.capacity, MAX_COLONIES_PER_PLANET);

/**
 * Planet and colony rows. The store is chosen once: Postgres when persistence is on (`persistenceEnabled`: colony rows
 * persist together with the planet snapshots, BE-14), else memory. Database errors propagate (BE-03). Colonies read or
 * written through here are also kept in a cache for the synchronous lookups of the WS ingress and the progression
 * forwarder; the cache is never consulted when the store answered.
 */
@Injectable()
export class HomeRepository {
  private readonly store: HomeStore;
  private readonly cache = new Map<string, ColonyRecord>();

  constructor(
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) env?: AppEnv,
  ) {
    this.store = prisma && env && persistenceEnabled(env) ? new PrismaHomeStore(prisma) : new MemoryHomeStore();
  }

  findPlanetById(id: string): Promise<PlanetRecord | null> {
    return this.store.findPlanet(id);
  }

  /**
   * A dev planet row created before its id named a type (pre-D-38 `pl_dev` = temperate) is retyped when nobody lives
   * on it, so the planet is regenerated with the right profile; with colonies the snapshot wipe (D-38) handles it.
   */
  private async fixDevPlanetType(planet: PlanetRecord): Promise<PlanetRecord> {
    const want = devPlanetTypeOf(planet.id);
    if (!want || planet.type === want) return planet;
    if ((await this.store.listColonies(planet.id)).length > 0) return planet;
    return (await this.store.setPlanetType(planet.id, want)) ?? planet;
  }

  async upsertDevPlanet(id: string, input: Partial<CreatePlanetInput> = {}): Promise<PlanetRecord> {
    const existing = await this.store.findPlanet(id);
    if (existing) return this.fixDevPlanetType(existing);
    const canonical = canonicalPlanetById(id);
    return this.store.upsertPlanet({
      id,
      name: input.name ?? canonical?.name ?? (id === 'pl_dev' ? 'Dev Planet' : id),
      type: input.type ?? canonical?.type ?? devPlanetTypeOf(id) ?? DEV_PLANET_TYPE, // the id names its family's type
      seed: input.seed ?? canonical?.seed ?? DEV_PLANET_SEED,
      radius: input.radius ?? (canonical ? W11_DEFAULT_SECTOR_RADIUS : DEV_PLANET_RADIUS),
      state: input.state ?? 'ACTIVE',
      capacity: input.capacity ?? (canonical ? 28 : DEV_PLANET_CAPACITY),
    });
  }

  /**
   * The first dev planet of `type` (one family per type: `devPlanetIdFor`) with a free seat, not in `skip`, from one
   * query over the family's seat counts (BE-05); the next index of the family is created when every one is full.
   * `skipIndices` (per planet id) are colony indices that cannot land there (the sim already landed them).
   */
  async findOrCreateOpenDevPlanet(
    type: DevPlanetType = DEV_PLANET_TYPE, skip?: ReadonlySet<string>, skipIndices?: ReadonlyMap<string, ReadonlySet<number>>,
  ): Promise<{ planet: PlanetRecord; colonyIndex: number }> {
    const family = (await this.store.listPlanets())
      .map((p) => ({ p, index: devPlanetIndexOf(type, p.id) }))
      .filter((f) => f.index > 0)
      .sort((a, b) => a.index - b.index);
    for (const { p } of family) {
      if (skip?.has(p.id) || isEnded(p) || p.seatsTaken >= seatsOf(p)) continue;
      const planet = await this.fixDevPlanetType(p);
      const slot = await this.freeColonyIndex(planet, skipIndices?.get(planet.id));
      if (slot !== undefined) return { planet, colonyIndex: slot };
    }
    const used = new Set(family.map((f) => f.index));
    let next = 1;
    while (used.has(next)) next++; // the first missing index: a wiped planet's id is reused
    const planet = await this.upsertDevPlanet(devPlanetIdFor(type, next), { name: devPlanetName(type, next), type, state: 'ACTIVE' });
    return { planet, colonyIndex: (await this.freeColonyIndex(planet, skipIndices?.get(planet.id))) ?? 0 };
  }

  private async freeColonyIndex(planet: PlanetRecord, skip?: ReadonlySet<number>): Promise<number | undefined> {
    const taken = new Set((await this.store.listColonies(planet.id)).map((c) => c.colonyIndex));
    for (let slot = 0; slot < seatsOf(planet); slot++) if (!taken.has(slot) && !skip?.has(slot)) return slot;
    return undefined;
  }

  async findLatestColonyByPlayerId(playerId: string): Promise<ColonyRecord | null> {
    return this.remember(await this.store.findLatestColony(playerId));
  }

  /** The player's colony on the planet: the cached one when known (WS ingress, every command), else from the store. */
  async findColonyByPlayerAndPlanet(playerId: string, planetId: string): Promise<ColonyRecord | null> {
    let latest: ColonyRecord | null = null;
    for (const c of this.cache.values()) {
      if (c.playerId === playerId && c.planetId === planetId && (!latest || c.createdAt.getTime() >= latest.createdAt.getTime())) latest = c;
    }
    return latest ?? this.remember(await this.store.findLatestColony(playerId, planetId));
  }

  async findColonyById(id: string): Promise<ColonyRecord | null> {
    return this.remember(await this.store.findColony(id));
  }

  /** Synchronous cache lookup (progression forwarder): only colonies this process read or wrote. */
  findCachedColonyById(id: string): ColonyRecord | null {
    return this.cache.get(id) ?? null;
  }

  async listColoniesByPlanetId(planetId: string): Promise<ColonyRecord[]> {
    return (await this.store.listColonies(planetId)).map((c) => this.remember(c));
  }

  async createColony(input: CreateColonyInput): Promise<{ colony: ColonyRecord; planet: PlanetRecord }> {
    const basePlanet = await this.upsertDevPlanet(input.planetId);
    const { colony, planet } = await this.store.createColony({
      id: input.id ?? newId('co'),
      playerId: input.playerId,
      planetId: input.planetId,
      colonyIndex: input.colonyIndex,
      name: input.name,
      color: input.color ?? input.colonyIndex,
      status: input.status ?? 'ACTIVE',
      foundingSectorId: input.foundingSectorId ?? 'sec_0_0',
      landingSlotId: input.landingSlotId ?? null,
      recapSeen: input.recapSeen ?? false,
      spawnQ: input.spawnQ,
      spawnR: input.spawnR,
    });
    return { colony: this.remember(colony), planet: planet ?? basePlanet };
  }

  /** Marks a player's latest (or specified) colony recap/results as seen. */
  async markRecapSeen(playerId: string, colonyId?: string): Promise<ColonyRecord | null> {
    const target = colonyId
      ? await this.findColonyById(colonyId)
      : await this.findLatestColonyByPlayerId(playerId);
    if (!target || target.playerId !== playerId) return null;
    return this.remember(await this.store.setColonyRecapSeen(target.id, true));
  }

  /** Removes a colony whose landing failed (seat rollback) and recounts its planet's seats. */
  async deleteColony(colonyId: string): Promise<void> {
    this.cache.delete(colonyId);
    await this.store.deleteColony(colonyId);
  }

  /** Dev wipe of a planet: deletes its colony rows (and their cache entries); returns how many. */
  async deleteColoniesOfPlanet(planetId: string): Promise<number> {
    for (const [id, c] of this.cache) if (c.planetId === planetId) this.cache.delete(id);
    return this.store.deleteColoniesOfPlanet(planetId);
  }

  async setColonyStatus(colonyId: string, status: string): Promise<ColonyRecord | null> {
    return this.remember(await this.store.setColonyStatus(colonyId, status));
  }

  setPlanetStatus(planetId: string, status: string): Promise<PlanetRecord | null> {
    return this.store.setPlanetState(planetId, status);
  }

  listPlanets(): Promise<PlanetRecord[]> {
    return this.store.listPlanets();
  }

  async listColonies(): Promise<ColonyRecord[]> {
    return (await this.store.listColonies()).map((c) => this.remember(c));
  }

  private remember<T extends ColonyRecord | null>(colony: T): T {
    if (colony) this.cache.set(colony.id, colony);
    return colony;
  }
}
