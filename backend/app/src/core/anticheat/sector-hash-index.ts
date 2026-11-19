import { W11_DEFAULT_SECTOR_RADIUS, type SectorId } from '@terra/contracts';
import { applyDiff, DEV_PLANET_CAPACITY, DEV_PLANET_RADIUS, restore, type PlanetState, type SimEvent } from '@terra/sim';
import {
  computeColonyBindingHash,
  computeSectorSpaceHash,
  fnv1a64Hex,
  inferAuthoritativeBaseSector,
  isValidSectorIdFormat,
  normalizeColonyStatus,
} from './anticheat.hash';
import type {
  BountySpatialRecord,
  ColonyBaseBinding,
  PlanetSpatialState,
  SectorSpaceEntry,
} from './anticheat.types';
import {
  applySimEventsToSpatialState,
  extractPlanetSpatialState,
} from './parts/planet-state-sync';

const sectorMapKey = (planetId: string, sectorId: string): string => `${planetId}\0${sectorId}`;
const planetColonyKey = (planetId: string, colonyIndex: number): string => `${planetId}\0${colonyIndex}`;

function refreshSectorCounts(sec: SectorSpaceEntry): void {
  const founded = Math.max(0, sec.untrackedFoundedSeats + sec.foundedColonyIds.size);
  sec.foundedSeats = founded;
  sec.freeSeats = sec.kind === 'ocean' ? 0 : Math.max(0, sec.capacity - sec.reservedSeats - founded);
  sec.spaceHash = computeSectorSpaceHash(sec);
}

/**
 * In-memory O(1) hash-based spatial & admission index for real-time anti-cheat checks.
 * Maintains live hashes of player base bindings, sector free seats, planet radii, and entity ownership.
 */
export class SectorHashIndex {
  private readonly planetsById = new Map<string, PlanetSpatialState>();
  private readonly sectorsByKey = new Map<string, SectorSpaceEntry>();
  private readonly sectorsByPlanet = new Map<string, Set<SectorId>>();
  private readonly byPlayerId = new Map<string, ColonyBaseBinding>();
  private readonly coloniesByPlayer = new Map<string, Set<string>>();
  private readonly byColonyId = new Map<string, ColonyBaseBinding>();
  private readonly byPlanetColony = new Map<string, ColonyBaseBinding>();
  private readonly byPlanetColonyName = new Map<string, ColonyBaseBinding>();
  private readonly replicasByPlanet = new Map<string, PlanetState>();

  getPlanet(planetId: string): PlanetSpatialState | undefined {
    return this.planetsById.get(planetId);
  }

  getSectorSpace(planetId: string, sectorId: string): SectorSpaceEntry | undefined {
    return this.sectorsByKey.get(sectorMapKey(planetId, sectorId));
  }

  listPlanetSectors(planetId: string): SectorSpaceEntry[] {
    const ids = this.sectorsByPlanet.get(planetId);
    if (!ids) return [];
    const out: SectorSpaceEntry[] = [];
    for (const secId of ids) {
      const entry = this.sectorsByKey.get(sectorMapKey(planetId, secId));
      if (entry) out.push(entry);
    }
    return out;
  }

  getActiveBaseByPlayer(playerId: string): ColonyBaseBinding | undefined {
    const binding = this.byPlayerId.get(playerId);
    if (binding && binding.status === 'ACTIVE') {
      const planet = this.planetsById.get(binding.planetId);
      if (!planet || (planet.status !== 'ENDED' && planet.status !== 'ARCHIVED')) return binding;
    }
    const ownedIds = this.coloniesByPlayer.get(playerId);
    if (!ownedIds) return undefined;
    for (const colId of ownedIds) {
      const col = this.byColonyId.get(colId);
      if (!col || col.status !== 'ACTIVE') continue;
      const planet = this.planetsById.get(col.planetId);
      if (!planet || (planet.status !== 'ENDED' && planet.status !== 'ARCHIVED')) return col;
    }
    return undefined;
  }

  getLatestBindingByPlayer(playerId: string): ColonyBaseBinding | undefined {
    return this.byPlayerId.get(playerId);
  }

  hasActiveColonyForPlayerOnPlanet(playerId: string, planetId: string): boolean {
    const ownedIds = this.coloniesByPlayer.get(playerId);
    if (!ownedIds) return false;
    for (const colId of ownedIds) {
      const col = this.byColonyId.get(colId);
      if (col && col.planetId === planetId && col.status === 'ACTIVE') return true;
    }
    return false;
  }

  getColonyById(colonyId: string): ColonyBaseBinding | undefined {
    return this.byColonyId.get(colonyId);
  }

  getColonyByPlanetIndex(planetId: string, colonyIndex: number): ColonyBaseBinding | undefined {
    return this.byPlanetColony.get(planetColonyKey(planetId, colonyIndex));
  }

  getColonyByPlanetName(planetId: string, lowerName: string): ColonyBaseBinding | undefined {
    return this.byPlanetColonyName.get(`${planetId}\0${lowerName}`);
  }

  registerBounty(planetId: string, bounty: BountySpatialRecord): void {
    const planet = this.planetsById.get(planetId) ?? this.upsertPlanetMeta({ planetId });
    planet.bountiesById.set(bounty.bountyId, bounty);
  }

  countActiveColoniesOnPlanet(planetId: string): number {
    let count = 0;
    for (const b of this.byColonyId.values()) {
      if (b.planetId === planetId && b.status === 'ACTIVE' && !b.isRivalAi) count++;
    }
    return count;
  }

  upsertPlanetMeta(input: {
    readonly planetId: string;
    readonly planetRadius?: number;
    readonly sectorRadius?: number;
    readonly hasMultiSectorGrid?: boolean;
    readonly crossSectorEnabled?: boolean;
    readonly status?: 'ACTIVE' | 'PAUSED' | 'ENDED' | 'ARCHIVED';
    readonly capacity?: number;
  }): PlanetSpatialState {
    const prev = this.planetsById.get(input.planetId);
    const synced = prev?.syncedFromSim === true;
    const planetRadius = synced ? prev.planetRadius : (input.planetRadius ?? prev?.planetRadius ?? DEV_PLANET_RADIUS);
    const sectorRadius = synced ? prev.sectorRadius : (input.sectorRadius ?? prev?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS);
    const hasMultiSectorGrid = synced
      ? prev.hasMultiSectorGrid
      : (input.hasMultiSectorGrid ?? prev?.hasMultiSectorGrid ?? false);
    const crossSectorEnabled = synced
      ? prev.crossSectorEnabled
      : (input.crossSectorEnabled ?? prev?.crossSectorEnabled ?? false);
    const status = input.status ?? prev?.status ?? 'ACTIVE';
    const capacity = input.capacity ?? prev?.capacity ?? DEV_PLANET_CAPACITY;
    const next: PlanetSpatialState = prev ?? {
      planetId: input.planetId,
      planetRadius,
      sectorRadius,
      hasMultiSectorGrid,
      crossSectorEnabled,
      status,
      capacity,
      nextEntityId: 1,
      maxEntityId: 0,
      knownSectorIds: new Set<SectorId>(),
      landSectorIds: new Set<SectorId>(),
      entitiesById: new Map(),
      bountiesById: new Map(),
      diplomacyOffersById: new Map(),
      diplomacyTrucesById: new Map(),
      diplomacyWarsById: new Map(),
      tileOwnerByPackedCoord: new Map(),
      rivalColonyIndices: new Set(),
      rivalAnchors: [],
      stateHash: '',
    };
    next.planetRadius = planetRadius;
    next.sectorRadius = sectorRadius;
    next.hasMultiSectorGrid = hasMultiSectorGrid;
    next.crossSectorEnabled = crossSectorEnabled;
    next.status = status;
    next.capacity = capacity;
    next.stateHash = fnv1a64Hex(['planet:meta', input.planetId, planetRadius, sectorRadius, hasMultiSectorGrid, crossSectorEnabled, status, capacity]);
    this.planetsById.set(input.planetId, next);
    return next;
  }

  upsertSectorSpace(input: {
    readonly planetId: string;
    readonly sectorId: SectorId;
    readonly kind: 'land' | 'ocean';
    readonly capacity: number;
    readonly reservedSeats?: number;
    readonly foundedSeats?: number;
    readonly freeSeats?: number;
  }): SectorSpaceEntry {
    const key = sectorMapKey(input.planetId, input.sectorId);
    const prev = this.sectorsByKey.get(key);
    const foundedColonyIds = prev?.foundedColonyIds ?? new Set<string>();
    for (const colId of [...foundedColonyIds]) {
      const col = this.byColonyId.get(colId);
      if (col && col.status !== 'ACTIVE') foundedColonyIds.delete(colId);
    }
    const capacity = input.kind === 'ocean' ? 0 : Math.max(0, input.capacity);
    const reservedSeats = Math.max(0, input.reservedSeats ?? prev?.reservedSeats ?? 0);
    const untrackedFoundedSeats =
      input.foundedSeats !== undefined
        ? Math.max(0, input.foundedSeats - foundedColonyIds.size)
        : (prev?.untrackedFoundedSeats ?? 0);
    const foundedSeats = Math.max(0, untrackedFoundedSeats + foundedColonyIds.size);
    const computedFree =
      input.kind === 'ocean' ? 0 : Math.max(0, capacity - reservedSeats - foundedSeats);
    const freeSeats =
      input.freeSeats !== undefined ? Math.min(computedFree, Math.max(0, input.freeSeats)) : computedFree;
    const spaceHash = computeSectorSpaceHash({
      planetId: input.planetId,
      sectorId: input.sectorId,
      kind: input.kind,
      capacity,
      reservedSeats,
      foundedSeats,
      freeSeats,
    });
    const entry: SectorSpaceEntry = {
      planetId: input.planetId,
      sectorId: input.sectorId,
      kind: input.kind,
      capacity,
      reservedSeats,
      untrackedFoundedSeats,
      foundedSeats,
      foundedColonyIds,
      freeSeats,
      spaceHash,
    };
    this.sectorsByKey.set(key, entry);
    let set = this.sectorsByPlanet.get(input.planetId);
    if (!set) {
      set = new Set<SectorId>();
      this.sectorsByPlanet.set(input.planetId, set);
    }
    set.add(input.sectorId);
    const planet = this.planetsById.get(input.planetId);
    if (planet) {
      planet.knownSectorIds.add(input.sectorId);
      if (input.kind === 'land') planet.landSectorIds.add(input.sectorId);
    }
    return entry;
  }

  upsertColonyBase(input: {
    readonly playerId: string;
    readonly colonyId: string;
    readonly planetId: string;
    readonly colonyIndex: number;
    readonly name?: string;
    readonly foundingSectorId?: string | null;
    readonly spawnQ?: number;
    readonly spawnR?: number;
    readonly status?: string;
    readonly authoritativeStatus?: boolean;
    readonly isRivalAi?: boolean;
  }): ColonyBaseBinding {
    const planet = this.planetsById.get(input.planetId);
    const prev = this.byColonyId.get(input.colonyId);
    const hasNonZeroSpawn =
      typeof input.spawnQ === 'number' &&
      typeof input.spawnR === 'number' &&
      (input.spawnQ !== 0 || input.spawnR !== 0);
    const baseQ = hasNonZeroSpawn ? input.spawnQ! : (prev?.baseQ ?? input.spawnQ ?? 0);
    const baseR = hasNonZeroSpawn ? input.spawnR! : (prev?.baseR ?? input.spawnR ?? 0);
    const baseSectorId = inferAuthoritativeBaseSector({
      foundingSectorId: input.foundingSectorId ?? prev?.baseSectorId,
      spawnQ: baseQ,
      spawnR: baseR,
      sectorRadius: planet?.sectorRadius,
      hasMultiSectorGrid: planet?.hasMultiSectorGrid,
    });
    const normalized = normalizeColonyStatus(input.status ?? prev?.status ?? 'ACTIVE');
    const status: 'ACTIVE' | 'ELIMINATED' | 'ENDED' =
      prev?.terminalFromLive && prev.status !== 'ACTIVE' && !input.authoritativeStatus && normalized === 'ACTIVE'
        ? prev.status
        : normalized;
    const terminalFromLive =
      status !== 'ACTIVE' && (Boolean(input.authoritativeStatus) || Boolean(prev?.terminalFromLive));
    const name = input.name?.trim() || prev?.name;
    const bindingHash = computeColonyBindingHash({
      playerId: input.playerId,
      planetId: input.planetId,
      colonyId: input.colonyId,
      colonyIndex: input.colonyIndex,
      baseSectorId,
      status,
    });
    const binding: ColonyBaseBinding = {
      playerId: input.playerId,
      colonyId: input.colonyId,
      planetId: input.planetId,
      colonyIndex: input.colonyIndex,
      ...(name ? { name } : {}),
      baseSectorId,
      baseQ,
      baseR,
      status,
      ...(terminalFromLive ? { terminalFromLive: true } : {}),
      isRivalAi: input.isRivalAi ?? prev?.isRivalAi,
      bindingHash,
      updatedAtMs: Date.now(),
    };
    if (prev?.name && prev.name !== name) this.byPlanetColonyName.delete(`${prev.planetId}\0${prev.name.toLowerCase()}`);
    if (name) this.byPlanetColonyName.set(`${binding.planetId}\0${name.toLowerCase()}`, binding);
    this.byColonyId.set(binding.colonyId, binding);
    this.byPlanetColony.set(planetColonyKey(binding.planetId, binding.colonyIndex), binding);
    this.indexPlayerBinding(binding);
    this.syncColonySectorSeat(prev, binding);
    return binding;
  }

  private indexPlayerBinding(binding: ColonyBaseBinding): void {
    if (!binding.playerId || binding.isRivalAi) return;
    let owned = this.coloniesByPlayer.get(binding.playerId);
    if (binding.status === 'ACTIVE') {
      if (!owned) {
        owned = new Set<string>();
        this.coloniesByPlayer.set(binding.playerId, owned);
      }
      owned.add(binding.colonyId);
      this.byPlayerId.set(binding.playerId, binding);
      return;
    }
    owned?.delete(binding.colonyId);
    const prevLatest = this.byPlayerId.get(binding.playerId);
    if (!prevLatest || prevLatest.colonyId === binding.colonyId) {
      this.byPlayerId.set(binding.playerId, binding);
    }
  }

  private syncColonySectorSeat(prev: ColonyBaseBinding | undefined, binding: ColonyBaseBinding): void {
    if (prev && prev.baseSectorId !== binding.baseSectorId) {
      const oldSec = this.sectorsByKey.get(sectorMapKey(prev.planetId, prev.baseSectorId));
      if (oldSec && oldSec.foundedColonyIds.delete(binding.colonyId)) refreshSectorCounts(oldSec);
    }
    const sec = this.sectorsByKey.get(sectorMapKey(binding.planetId, binding.baseSectorId));
    if (!sec || binding.isRivalAi || sec.kind !== 'land') return;
    if (binding.status === 'ACTIVE') sec.foundedColonyIds.add(binding.colonyId);
    else sec.foundedColonyIds.delete(binding.colonyId);
    refreshSectorCounts(sec);
  }

  removeColony(colonyId: string): void {
    const prev = this.byColonyId.get(colonyId);
    if (!prev) return;
    this.byColonyId.delete(colonyId);
    this.coloniesByPlayer.get(prev.playerId)?.delete(colonyId);
    if (this.byPlayerId.get(prev.playerId)?.colonyId === colonyId) {
      this.byPlayerId.delete(prev.playerId);
    }
    if (this.byPlanetColony.get(planetColonyKey(prev.planetId, prev.colonyIndex))?.colonyId === colonyId) {
      this.byPlanetColony.delete(planetColonyKey(prev.planetId, prev.colonyIndex));
    }
    if (prev.name && this.byPlanetColonyName.get(`${prev.planetId}\0${prev.name.toLowerCase()}`)?.colonyId === colonyId) {
      this.byPlanetColonyName.delete(`${prev.planetId}\0${prev.name.toLowerCase()}`);
    }
    const sec = this.sectorsByKey.get(sectorMapKey(prev.planetId, prev.baseSectorId));
    if (sec && sec.foundedColonyIds.delete(colonyId)) refreshSectorCounts(sec);
  }

  markColonyStatus(colonyId: string, status: string): void {
    const prev = this.byColonyId.get(colonyId);
    if (!prev) return;
    this.upsertColonyBase({
      playerId: prev.playerId,
      colonyId: prev.colonyId,
      planetId: prev.planetId,
      colonyIndex: prev.colonyIndex,
      name: prev.name,
      foundingSectorId: prev.baseSectorId,
      spawnQ: prev.baseQ,
      spawnR: prev.baseR,
      status,
      authoritativeStatus: true,
      isRivalAi: prev.isRivalAi,
    });
  }

  syncFromPlanetState(planetId: string, state: PlanetState): PlanetSpatialState {
    if (this.replicasByPlanet.has(planetId) && this.replicasByPlanet.get(planetId) !== state) {
      this.replicasByPlanet.delete(planetId);
    }
    const prev = this.planetsById.get(planetId);
    const { spatial, colonies, atlasSectors } = extractPlanetSpatialState(planetId, state, prev);
    this.planetsById.set(planetId, spatial);
    for (const s of atlasSectors) {
      if (isValidSectorIdFormat(s.sectorId) && !this.getSectorSpace(planetId, s.sectorId)) {
        this.upsertSectorSpace({ planetId, sectorId: s.sectorId, kind: s.kind === 'ocean' ? 'ocean' : 'land', capacity: s.foundingCapacity ?? 4 });
      }
    }
    for (const col of colonies) {
      const known =
        (col.colonyId ? this.byColonyId.get(col.colonyId) : undefined) ??
        this.byPlanetColony.get(planetColonyKey(planetId, col.colonyIndex));
      const colonyId = col.colonyId ?? known?.colonyId ?? `col_${planetId}_${col.colonyIndex}`;
      const playerId = col.playerId ?? known?.playerId ?? (col.isRivalAi ? `ai:${planetId}:${col.colonyIndex}` : '');
      const foundingSectorId =
        spatial.hasMultiSectorGrid && col.baseSectorId !== 'sec_0_0'
          ? col.baseSectorId
          : known?.baseSectorId && known.baseSectorId !== 'sec_0_0'
            ? known.baseSectorId
            : col.baseSectorId;
      this.upsertColonyBase({
        playerId,
        colonyId,
        planetId,
        colonyIndex: col.colonyIndex,
        name: col.name ?? known?.name,
        foundingSectorId,
        spawnQ: col.baseQ || known?.baseQ || 0,
        spawnR: col.baseR || known?.baseR || 0,
        status: col.status,
        authoritativeStatus: col.status !== 'ACTIVE',
        isRivalAi: col.isRivalAi,
      });
    }
    return spatial;
  }

  syncFromSnapshotBytes(planetId: string, bytes: Uint8Array): PlanetSpatialState | null {
    try {
      const state = restore(bytes);
      this.replicasByPlanet.set(planetId, state);
      return this.syncFromPlanetState(planetId, state);
    } catch {
      return null;
    }
  }

  applyDelta(planetId: string, diff: Uint8Array, events: readonly SimEvent[]): void {
    const replica = this.replicasByPlanet.get(planetId);
    if (replica) {
      try {
        applyDiff(replica, diff);
        this.syncFromPlanetState(planetId, replica);
        return;
      } catch {
        this.replicasByPlanet.delete(planetId);
      }
    }
    this.applyEvents(planetId, events);
  }

  applyEvents(planetId: string, events: readonly SimEvent[]): void {
    const spatial = this.planetsById.get(planetId);
    if (spatial && events.length > 0) {
      applySimEventsToSpatialState(
        spatial,
        events,
        (colId) => this.byColonyId.get(colId),
        ({ colonyId, colonyIndex }) => {
          if (colonyId) this.markColonyStatus(colonyId, 'ELIMINATED');
          else if (colonyIndex !== undefined) {
            const found = this.byPlanetColony.get(planetColonyKey(planetId, colonyIndex));
            if (found) this.markColonyStatus(found.colonyId, 'ELIMINATED');
          }
        },
      );
    } else {
      for (const ev of events) {
        if (ev.kind === 'colonyEliminated') {
          const data = (ev.data ?? {}) as { colonyId?: string; colonyIndex?: number };
          if (typeof data.colonyId === 'string') this.markColonyStatus(data.colonyId, 'ELIMINATED');
          else if (typeof data.colonyIndex === 'number') {
            const found = this.byPlanetColony.get(planetColonyKey(planetId, data.colonyIndex));
            if (found) this.markColonyStatus(found.colonyId, 'ELIMINATED');
          }
        }
      }
    }
  }

  removePlanet(planetId: string): void {
    this.replicasByPlanet.delete(planetId);
    const planet = this.planetsById.get(planetId);
    if (planet) {
      planet.syncedFromSim = false;
      planet.entitiesById.clear();
      planet.bountiesById.clear();
      planet.diplomacyOffersById.clear();
      planet.diplomacyTrucesById.clear();
      planet.diplomacyWarsById.clear();
      planet.tileOwnerByPackedCoord.clear();
    }
  }
}
