import { globalTileToSector } from '../../atlas/partition';
import { ENTITY_KIND } from '../../ecs/columns';
import type { SimState } from '../../kernel/state';
import type { PlacementEntity, PlacementTile, PlacementWorld } from './placement';

/** An open queue entry as placement reads it (authoritative `blobs.queue` or a replica's colony queue). */
export interface PlannedQueueEntryLike {
  colonyIndex?: number;
  state?: string;
  task?: { kind?: string; building?: string; q?: number; r?: number };
}

/**
 * The open `build` orders of `entries` as `PlacementWorld.plannedSites` (one adapter for host and client, so a queued
 * Power Pylon extends the power zone the same way on both sides).
 */
export function plannedSitesFromQueue(entries: readonly (PlannedQueueEntryLike | null | undefined)[]): NonNullable<PlacementWorld['plannedSites']> {
  const out: Array<{ owner: number; building: string; q: number; r: number }> = [];
  for (const e of entries) {
    const t = e?.task;
    if (!e || e.state === 'done' || e.state === 'cancelled' || t?.kind !== 'build' || typeof t.building !== 'string') continue;
    if (typeof t.q !== 'number' || typeof t.r !== 'number' || typeof e.colonyIndex !== 'number') continue;
    out.push({ owner: e.colonyIndex, building: t.building, q: t.q, r: t.r });
  }
  return out;
}

/** Adapts authoritative `SimState` (server / browser-local host) into the read-only `PlacementWorld`. */
export function placementWorldFromState(state: SimState): PlacementWorld {
  const L = state.grid.layers;
  const e = state.entities;
  const c = e.cols;
  const entities: PlacementEntity[] = [];
  for (let i = 0; i < e.count; i++) {
    entities.push({
      id: c.id[i],
      kind: c.kind[i],
      owner: c.owner[i],
      q: c.q[i],
      r: c.r[i],
      hp: c.hp[i],
      hpMax: c.hpMax[i],
      state: c.state[i],
      tier: c.tier[i],
    });
  }
  const rawAtlas = state.blobs.atlas as { value?: unknown } | undefined;
  const atlas = (rawAtlas && typeof rawAtlas === 'object' && 'value' in rawAtlas ? rawAtlas.value : rawAtlas) as
    | { sectorRadius?: number; foundingSectorByColony?: Readonly<Record<number, string>> }
    | undefined;
  const sectorRadius = typeof atlas?.sectorRadius === 'number' ? atlas.sectorRadius : undefined;
  const foundingByColony: Record<number, string> = { ...(atlas?.foundingSectorByColony ?? {}) };
  for (const col of state.colonies) {
    if (col && col.index >= 0 && typeof col.foundingSectorId === 'string' && !foundingByColony[col.index]) {
      foundingByColony[col.index] = col.foundingSectorId;
    }
  }
  return {
    radius: state.grid.radius,
    tileCount: state.grid.count,
    terrain: L.terrain as ArrayLike<number>,
    prep: L.prep as ArrayLike<number>,
    deposit: (L.deposit as ArrayLike<number> | undefined) ?? null,
    richness: (L.richness as ArrayLike<number> | undefined) ?? null,
    owner: L.owner as ArrayLike<number>,
    height: (L.height as ArrayLike<number> | undefined) ?? null,
    valid: (L as { valid?: ArrayLike<number> }).valid ?? null,
    entities,
    plannedSites: plannedSitesFromQueue((state.blobs.queue?.value as { entries?: PlannedQueueEntryLike[] } | undefined)?.entries ?? []),
    ...(sectorRadius !== undefined ? { sectorRadius, colonyFoundingSectorById: foundingByColony } : {}),
  };
}

/**
 * Returns `true` when `world` has an atlas sector radius and the placement at `(q, r)` either straddles a sector seam
 * or lies in a different sector from the colony's existing HQ / pod / Command Hub (or founding sector).
 */
export function isPlacementBlockedBySectorIsolation(
  world: PlacementWorld,
  colonyId: number,
  q: number,
  r: number,
  tiles: readonly PlacementTile[],
): boolean {
  const sectorRadius = world.sectorRadius;
  if (!sectorRadius || sectorRadius <= 0) return false;
  const anchorSectorId = globalTileToSector(q, r, sectorRadius).sectorId;
  for (const t of tiles) {
    if (globalTileToSector(t.q, t.r, sectorRadius).sectorId !== anchorSectorId) return true;
  }
  const homeEntity = world.entities.find(
    (e) =>
      e.owner === colonyId &&
      !(e.hpMax > 0 && e.hp <= 0) &&
      (e.kind === ENTITY_KIND.hq || e.kind === ENTITY_KIND.pod || e.kind === ENTITY_KIND.commandHub),
  );
  if (homeEntity) {
    const homeSectorId = globalTileToSector(homeEntity.q, homeEntity.r, sectorRadius).sectorId;
    if (anchorSectorId !== homeSectorId) return true;
  } else {
    const foundingSectorId = world.colonyFoundingSectorById?.[colonyId];
    if (foundingSectorId && (world.radius > sectorRadius + 4 || anchorSectorId !== 'sec_0_0')) {
      if (anchorSectorId !== foundingSectorId) return true;
    }
  }
  return false;
}
