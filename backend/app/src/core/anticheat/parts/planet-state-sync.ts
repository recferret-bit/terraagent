import { W11_DEFAULT_SECTOR_RADIUS, type SectorId } from '@terra/contracts';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  isRivalAiColony,
  type PlanetState,
  type SimEvent,
} from '@terra/sim';
import {
  fnv1a64Hex,
  inferAuthoritativeBaseSector,
  isValidSectorIdFormat,
  packAxialCoord,
  resolveTileSectorFast,
} from '../anticheat.hash';
import type {
  BountySpatialRecord,
  DiplomacyOfferSpatialRecord,
  DiplomacyTruceSpatialRecord,
  DiplomacyWarSpatialRecord,
  EntitySpatialRecord,
  PlanetSpatialState,
  RivalAnchorRecord,
} from '../anticheat.types';

export interface RawAtlasSector {
  readonly sectorId?: string;
  readonly kind?: 'land' | 'ocean';
  readonly foundingCapacity?: number;
}

interface RawAtlasBlob {
  readonly sectorRadius?: number;
  readonly crossSectorEnabled?: boolean;
  readonly sectors?: readonly RawAtlasSector[];
  readonly foundingSectorByColony?: Readonly<Record<number, string>>;
}

export interface SimColonySnapshotBinding {
  readonly colonyIndex: number;
  readonly colonyId?: string;
  readonly playerId?: string;
  readonly name?: string;
  readonly baseSectorId: SectorId;
  readonly baseQ: number;
  readonly baseR: number;
  readonly status: 'ACTIVE' | 'ELIMINATED' | 'ENDED';
  readonly isRivalAi: boolean;
}

function readRawBlob<T>(raw: unknown): T | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if ('value' in (raw as Record<string, unknown>)) {
    return (raw as { value?: T }).value;
  }
  return raw as T;
}

function collectRivalMetadata(state: PlanetState): {
  readonly indices: Set<number>;
  readonly anchors: RivalAnchorRecord[];
} {
  const indices = new Set<number>();
  const anchors: RivalAnchorRecord[] = [];
  for (const col of state.colonies) {
    if (col && col.index >= 0 && isRivalAiColony(state, col.index)) indices.add(col.index);
  }
  const rivalBlob = readRawBlob<{ rivals?: Record<string, { colonyIndex?: number; anchorQ?: number; anchorR?: number }> }>(
    state.blobs.rivalAi,
  );
  for (const rv of Object.values(rivalBlob?.rivals ?? {})) {
    if (typeof rv?.colonyIndex === 'number' && typeof rv.anchorQ === 'number' && typeof rv.anchorR === 'number') {
      indices.add(rv.colonyIndex);
      anchors.push({ colonyIndex: rv.colonyIndex, anchorQ: rv.anchorQ, anchorR: rv.anchorR });
    }
  }
  return { indices, anchors };
}

function collectColonySnapshots(
  state: PlanetState,
  atlas: RawAtlasBlob | undefined,
  sectorRadius: number,
  hasMultiSectorGrid: boolean,
  rivalColonyIndices: ReadonlySet<number>,
): {
  readonly colonies: SimColonySnapshotBinding[];
  readonly sectorByColonyIndex: Map<number, SectorId>;
} {
  const baseCoordsByColony = new Map<number, { q: number; r: number; rank: number }>();
  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    const owner = cols.owner[row] ?? -1;
    const hp = cols.hp[row] ?? 0;
    const hpMax = cols.hpMax[row] ?? 0;
    if (owner < 0 || (hpMax > 0 && hp <= 0) || cols.state[row] === ENTITY_STATE.inert) continue;
    const kind = cols.kind[row] ?? -1;
    const rank = kind === ENTITY_KIND.hub ? 3 : kind === ENTITY_KIND.hq ? 2 : kind === ENTITY_KIND.pod ? 1 : 0;
    if (rank > (baseCoordsByColony.get(owner)?.rank ?? 0)) {
      baseCoordsByColony.set(owner, { q: Math.round(cols.q[row] ?? 0), r: Math.round(cols.r[row] ?? 0), rank });
    }
  }

  const sectorByColonyIndex = new Map<number, SectorId>();
  const colonies: SimColonySnapshotBinding[] = [];
  for (const col of state.colonies) {
    if (!col || col.index < 0) continue;
    const anchor = baseCoordsByColony.get(col.index);
    const rawFounding =
      atlas?.foundingSectorByColony?.[col.index] ??
      (typeof col.foundingSectorId === 'string' ? col.foundingSectorId : undefined);
    const baseSectorId = inferAuthoritativeBaseSector({
      foundingSectorId: rawFounding,
      spawnQ: anchor?.q,
      spawnR: anchor?.r,
      sectorRadius,
      hasMultiSectorGrid,
    });
    sectorByColonyIndex.set(col.index, baseSectorId);
    const rawStatus = String(col.status ?? 'active').toLowerCase();
    const status: 'ACTIVE' | 'ELIMINATED' | 'ENDED' =
      rawStatus === 'eliminated'
        ? 'ELIMINATED'
        : rawStatus === 'settled' || rawStatus === 'ended' || rawStatus === 'transferred' || rawStatus === 'abandoned'
          ? 'ENDED'
          : 'ACTIVE';
    colonies.push({
      colonyIndex: col.index,
      colonyId: typeof col.id === 'string' && col.id ? col.id : undefined,
      playerId: typeof col.playerId === 'string' && col.playerId ? col.playerId : undefined,
      name: typeof col.name === 'string' && col.name ? col.name : undefined,
      baseSectorId,
      baseQ: anchor?.q ?? 0,
      baseR: anchor?.r ?? 0,
      status,
      isRivalAi: rivalColonyIndices.has(col.index),
    });
  }
  return { colonies, sectorByColonyIndex };
}

function collectEntitiesAndOwnedTiles(
  state: PlanetState,
  planetRadius: number,
  sectorRadius: number,
  hasMultiSectorGrid: boolean,
  sectorByColonyIndex: ReadonlyMap<number, SectorId>,
): {
  readonly entitiesById: Map<number, EntitySpatialRecord>;
  readonly tileOwnerByPackedCoord: Map<number, number>;
  readonly maxEntityId: number;
} {
  const cols = state.entities.cols;
  const entitiesById = new Map<number, EntitySpatialRecord>();
  let maxEntityId = 0;
  for (let row = 0; row < state.entities.count; row++) {
    const entityId = cols.id[row]!;
    if (entityId > maxEntityId) maxEntityId = entityId;
    const ownerColonyIndex = cols.owner[row] ?? -1;
    const q = Math.round(cols.q[row] ?? 0);
    const r = Math.round(cols.r[row] ?? 0);
    const hp = cols.hp[row] ?? 0;
    const hpMax = cols.hpMax[row] ?? 0;
    const alive = !(hpMax > 0 && hp <= 0) && cols.state[row] !== ENTITY_STATE.inert;
    const sectorId: SectorId = hasMultiSectorGrid
      ? resolveTileSectorFast(q, r, sectorRadius)
      : (sectorByColonyIndex.get(ownerColonyIndex) ?? 'sec_0_0');
    entitiesById.set(entityId, { entityId, ownerColonyIndex, kind: cols.kind[row] ?? 0, q, r, sectorId, alive });
  }

  const tileOwnerByPackedCoord = new Map<number, number>();
  const ownerLayer = state.grid.layers.owner;
  if (ownerLayer) {
    const hx = hexIndex(planetRadius);
    const lim = Math.min(state.grid.count, hx.count);
    for (let i = 0; i < lim; i++) {
      const owner = ownerLayer[i] ?? -1;
      if (owner >= 0) tileOwnerByPackedCoord.set(packAxialCoord(hx.q[i]!, hx.r[i]!), owner);
    }
  }
  return { entitiesById, tileOwnerByPackedCoord, maxEntityId };
}

function collectBountySnapshots(
  state: PlanetState,
  sectorRadius: number,
  hasMultiSectorGrid: boolean,
  entitiesById: ReadonlyMap<number, EntitySpatialRecord>,
  sectorByColonyIndex: ReadonlyMap<number, SectorId>,
): Map<string, BountySpatialRecord> {
  const bountiesById = new Map<string, BountySpatialRecord>();
  const rawBounty = readRawBlob<{
    bounties?: readonly {
      id?: string;
      poster?: number;
      target?: { kind?: string; q?: number; r?: number; nestId?: string };
    }[];
  }>(state.blobs.bounty);
  for (const b of rawBounty?.bounties ?? []) {
    if (!b || typeof b.id !== 'string' || !b.id) continue;
    const posterColonyIndex = typeof b.poster === 'number' ? b.poster : -1;
    const targetKind = typeof b.target?.kind === 'string' ? b.target.kind : 'unknown';
    let sectorId: SectorId | undefined;
    if (targetKind === 'defend_area' && typeof b.target?.q === 'number' && typeof b.target?.r === 'number') {
      sectorId = hasMultiSectorGrid
        ? resolveTileSectorFast(b.target.q, b.target.r, sectorRadius)
        : (sectorByColonyIndex.get(posterColonyIndex) ?? 'sec_0_0');
    } else if (targetKind === 'clear_nest' && typeof b.target?.nestId === 'string' && /^\d+$/.test(b.target.nestId)) {
      sectorId = entitiesById.get(Number(b.target.nestId))?.sectorId ?? sectorByColonyIndex.get(posterColonyIndex);
    } else if (targetKind !== 'deliver_units') {
      sectorId = sectorByColonyIndex.get(posterColonyIndex);
    }
    bountiesById.set(b.id, { bountyId: b.id, posterColonyIndex, targetKind, ...(sectorId ? { sectorId } : {}) });
  }
  return bountiesById;
}

function collectDiplomacySnapshots(state: PlanetState): {
  readonly diplomacyOffersById: Map<string, DiplomacyOfferSpatialRecord>;
  readonly diplomacyTrucesById: Map<string, DiplomacyTruceSpatialRecord>;
  readonly diplomacyWarsById: Map<string, DiplomacyWarSpatialRecord>;
} {
  const diplomacyOffersById = new Map<string, DiplomacyOfferSpatialRecord>();
  const diplomacyTrucesById = new Map<string, DiplomacyTruceSpatialRecord>();
  const diplomacyWarsById = new Map<string, DiplomacyWarSpatialRecord>();
  const rawDip = readRawBlob<{
    offers?: Readonly<Record<string, { offerId?: string; fromColonyIndex?: number; fromColony?: number; toColonyIndex?: number; toColony?: number }>>;
    truces?: Readonly<Record<string, { truceId?: string; colonyAIndex?: number; colonyA?: number; colonyBIndex?: number; colonyB?: number }>>;
    wars?: Readonly<Record<string, { warId?: string; attackerColonyIndex?: number; attackerColony?: number; defenderColonyIndex?: number; defenderColony?: number }>>;
  }>(state.blobs.diplomacy);
  for (const [key, o] of Object.entries(rawDip?.offers ?? {})) {
    const id = typeof o?.offerId === 'string' ? o.offerId : key;
    const from = typeof o?.fromColonyIndex === 'number' ? o.fromColonyIndex : (o?.fromColony ?? -1);
    const to = typeof o?.toColonyIndex === 'number' ? o.toColonyIndex : (o?.toColony ?? -1);
    if (id && from >= 0 && to >= 0) diplomacyOffersById.set(id, { offerId: id, fromColonyIndex: from, toColonyIndex: to });
  }
  for (const [key, t] of Object.entries(rawDip?.truces ?? {})) {
    const id = typeof t?.truceId === 'string' ? t.truceId : key;
    const a = typeof t?.colonyAIndex === 'number' ? t.colonyAIndex : (t?.colonyA ?? -1);
    const b = typeof t?.colonyBIndex === 'number' ? t.colonyBIndex : (t?.colonyB ?? -1);
    if (id && a >= 0 && b >= 0) diplomacyTrucesById.set(id, { truceId: id, colonyAIndex: a, colonyBIndex: b });
  }
  for (const [key, w] of Object.entries(rawDip?.wars ?? {})) {
    const id = typeof w?.warId === 'string' ? w.warId : key;
    const att = typeof w?.attackerColonyIndex === 'number' ? w.attackerColonyIndex : (w?.attackerColony ?? -1);
    const def = typeof w?.defenderColonyIndex === 'number' ? w.defenderColonyIndex : (w?.defenderColony ?? -1);
    if (id && att >= 0 && def >= 0) diplomacyWarsById.set(id, { warId: id, attackerColonyIndex: att, defenderColonyIndex: def });
  }
  return { diplomacyOffersById, diplomacyTrucesById, diplomacyWarsById };
}

export function extractPlanetSpatialState(
  planetId: string,
  state: PlanetState,
  existing?: PlanetSpatialState,
): {
  readonly spatial: PlanetSpatialState;
  readonly colonies: SimColonySnapshotBinding[];
  readonly atlasSectors: readonly RawAtlasSector[];
} {
  const atlas = readRawBlob<RawAtlasBlob>(state.blobs.atlas);
  const pvp = readRawBlob<{ crossSectorEnabled?: boolean }>(state.blobs.pvp);
  const planetRadius = state.grid.radius;
  const sectorRadius =
    typeof atlas?.sectorRadius === 'number' && atlas.sectorRadius > 0
      ? atlas.sectorRadius
      : W11_DEFAULT_SECTOR_RADIUS;
  const hasMultiSectorGrid = planetRadius > sectorRadius && Boolean(atlas);
  const crossSectorEnabled = Boolean(pvp?.crossSectorEnabled ?? atlas?.crossSectorEnabled);

  const knownSectorIds = new Set<SectorId>(existing?.knownSectorIds ?? []);
  const landSectorIds = new Set<SectorId>(existing?.landSectorIds ?? []);
  for (const s of atlas?.sectors ?? []) {
    if (isValidSectorIdFormat(s.sectorId)) {
      knownSectorIds.add(s.sectorId);
      if (s.kind !== 'ocean') landSectorIds.add(s.sectorId);
    }
  }

  const { indices: rivalColonyIndices, anchors: rivalAnchors } = collectRivalMetadata(state);
  const { colonies, sectorByColonyIndex } = collectColonySnapshots(
    state,
    atlas,
    sectorRadius,
    hasMultiSectorGrid,
    rivalColonyIndices,
  );
  const { entitiesById, tileOwnerByPackedCoord, maxEntityId } = collectEntitiesAndOwnedTiles(
    state,
    planetRadius,
    sectorRadius,
    hasMultiSectorGrid,
    sectorByColonyIndex,
  );
  const bountiesById = collectBountySnapshots(
    state,
    sectorRadius,
    hasMultiSectorGrid,
    entitiesById,
    sectorByColonyIndex,
  );
  if (existing) {
    for (const [bId, bRec] of existing.bountiesById) {
      if (!bountiesById.has(bId)) bountiesById.set(bId, bRec);
    }
  }
  const { diplomacyOffersById, diplomacyTrucesById, diplomacyWarsById } = collectDiplomacySnapshots(state);

  const nextEntityId = Math.max(state.meta.nextEntityId ?? 1, maxEntityId + 1);
  const stateHash = fnv1a64Hex([
    'planet:v1',
    planetId,
    state.meta.tick,
    planetRadius,
    sectorRadius,
    hasMultiSectorGrid,
    crossSectorEnabled,
    entitiesById.size,
    colonies.length,
  ]);

  return {
    spatial: {
      planetId,
      planetRadius,
      sectorRadius,
      hasMultiSectorGrid,
      crossSectorEnabled,
      status: existing?.status ?? 'ACTIVE',
      capacity: existing?.capacity ?? 28,
      nextEntityId,
      maxEntityId,
      knownSectorIds,
      landSectorIds,
      entitiesById,
      bountiesById,
      diplomacyOffersById,
      diplomacyTrucesById,
      diplomacyWarsById,
      tileOwnerByPackedCoord,
      rivalColonyIndices,
      rivalAnchors,
      syncedFromSim: true,
      stateHash,
    },
    colonies,
    atlasSectors: atlas?.sectors ?? [],
  };
}

function applyDiplomacySimEvent(spatial: PlanetSpatialState, kind: string, data: Record<string, unknown>): boolean {
  if (kind === 'truceOffered' && typeof data.offerId === 'string') {
    const from = typeof data.fromColonyIndex === 'number' ? data.fromColonyIndex : (typeof data.fromColony === 'number' ? data.fromColony : -1);
    const to = typeof data.toColonyIndex === 'number' ? data.toColonyIndex : (typeof data.toColony === 'number' ? data.toColony : -1);
    if (from >= 0 && to >= 0) spatial.diplomacyOffersById.set(data.offerId, { offerId: data.offerId, fromColonyIndex: from, toColonyIndex: to });
    return true;
  }
  if (kind === 'truceSigned' && typeof data.truceId === 'string') {
    if (typeof data.offerId === 'string') spatial.diplomacyOffersById.delete(data.offerId);
    const a = typeof data.colonyAIndex === 'number' ? data.colonyAIndex : -1;
    const b = typeof data.colonyBIndex === 'number' ? data.colonyBIndex : -1;
    if (a >= 0 && b >= 0) spatial.diplomacyTrucesById.set(data.truceId, { truceId: data.truceId, colonyAIndex: a, colonyBIndex: b });
    return true;
  }
  if (kind === 'truceEnded' && typeof data.truceId === 'string') {
    spatial.diplomacyTrucesById.delete(data.truceId);
    return true;
  }
  if (kind === 'warDeclared' && typeof data.warId === 'string') {
    const att = typeof data.attackerColonyIndex === 'number' ? data.attackerColonyIndex : (typeof data.attackerColony === 'number' ? data.attackerColony : -1);
    const def = typeof data.defenderColonyIndex === 'number' ? data.defenderColonyIndex : (typeof data.defenderColony === 'number' ? data.defenderColony : -1);
    if (att >= 0 && def >= 0) spatial.diplomacyWarsById.set(data.warId, { warId: data.warId, attackerColonyIndex: att, defenderColonyIndex: def });
    return true;
  }
  if (kind === 'warEnded' && typeof data.warId === 'string') {
    spatial.diplomacyWarsById.delete(data.warId);
    return true;
  }
  return false;
}

export function applySimEventsToSpatialState(
  spatial: PlanetSpatialState,
  events: readonly SimEvent[],
  resolveColonyById: (colonyId: string) => { colonyIndex: number; baseSectorId: SectorId } | undefined,
  onColonyEliminated: (ref: { colonyId?: string; colonyIndex?: number }) => void,
): void {
  for (const ev of events) {
    const data = (ev.data ?? {}) as Record<string, unknown>;
    if (applyDiplomacySimEvent(spatial, ev.kind, data)) continue;
    if (ev.kind === 'colonyEliminated') {
      onColonyEliminated({
        colonyId: typeof data.colonyId === 'string' ? data.colonyId : undefined,
        colonyIndex: typeof data.colonyIndex === 'number' ? data.colonyIndex : undefined,
      });
      continue;
    }
    if (ev.kind === 'hqLanded' || ev.kind === 'colonyFounded' || ev.kind === 'unitProduced' || ev.kind === 'buildingCompleted') {
      const q = typeof data.q === 'number' ? Math.round(data.q) : 0;
      const r = typeof data.r === 'number' ? Math.round(data.r) : 0;
      const colInfo = typeof data.colonyId === 'string' ? resolveColonyById(data.colonyId) : undefined;
      const rawEvColony = ev.colonyIds?.[0];
      const fallbackOwner =
        typeof rawEvColony === 'number'
          ? rawEvColony
          : typeof rawEvColony === 'string'
            ? (resolveColonyById(rawEvColony)?.colonyIndex ?? 0)
            : 0;
      const sectorId = spatial.hasMultiSectorGrid
        ? resolveTileSectorFast(q, r, spatial.sectorRadius)
        : (colInfo?.baseSectorId ?? 'sec_0_0');
      const primaryId = typeof data.entityId === 'number' ? data.entityId : (typeof data.hubId === 'number' ? data.hubId : -1);
      const podId = ev.kind === 'hqLanded' && typeof data.podEntityId === 'number' ? data.podEntityId : -1;
      for (const [id, entKind] of [
        [primaryId, ev.kind === 'hqLanded' ? ENTITY_KIND.hq : ev.kind === 'colonyFounded' ? ENTITY_KIND.hub : 0],
        [podId, ENTITY_KIND.pod],
      ] as const) {
        if (id > 0) {
          spatial.entitiesById.set(id, { entityId: id, ownerColonyIndex: colInfo?.colonyIndex ?? fallbackOwner, kind: entKind, q, r, sectorId, alive: true });
          if (id > spatial.maxEntityId) spatial.maxEntityId = id;
          if (id >= spatial.nextEntityId) spatial.nextEntityId = id + 1;
        }
      }
      continue;
    }
    if (ev.kind === 'bountyPosted' && typeof data.bountyId === 'string') {
      const posterInfo = typeof data.posterId === 'string' ? resolveColonyById(data.posterId) : undefined;
      const target = (data.target && typeof data.target === 'object' ? data.target : {}) as Record<string, unknown>;
      const targetKind = typeof target.kind === 'string' ? target.kind : 'unknown';
      let sectorId: SectorId | undefined;
      if (targetKind === 'defend_area' && typeof target.q === 'number' && typeof target.r === 'number') {
        sectorId = spatial.hasMultiSectorGrid
          ? resolveTileSectorFast(target.q, target.r, spatial.sectorRadius)
          : (posterInfo?.baseSectorId ?? 'sec_0_0');
      } else if (targetKind === 'clear_nest' && typeof target.nestId === 'string' && /^\d+$/.test(target.nestId)) {
        sectorId = spatial.entitiesById.get(Number(target.nestId))?.sectorId ?? posterInfo?.baseSectorId;
      } else if (targetKind !== 'deliver_units') {
        sectorId = posterInfo?.baseSectorId;
      }
      spatial.bountiesById.set(data.bountyId, {
        bountyId: data.bountyId,
        posterColonyIndex: posterInfo?.colonyIndex ?? -1,
        targetKind,
        ...(sectorId ? { sectorId } : {}),
      });
      continue;
    }
    if (ev.kind === 'unitDestroyed' || ev.kind === 'buildingDestroyed' || ev.kind === 'nestDestroyed') {
      const entityId =
        typeof data.entityId === 'number'
          ? data.entityId
          : typeof data.hiveId === 'number'
            ? data.hiveId
            : -1;
      const prev = entityId > 0 ? spatial.entitiesById.get(entityId) : undefined;
      if (prev) spatial.entitiesById.set(entityId, { ...prev, alive: false });
    }
  }
}
