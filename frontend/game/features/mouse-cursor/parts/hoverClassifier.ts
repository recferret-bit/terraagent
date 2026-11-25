import {
  DEPOSIT,
  ENTITY_KIND,
  HEX_DIRS,
  PREP,
  TERRAIN,
  getWreckTileSet,
  globalTileToSector,
  hexIndex,
  isGroundMoveBlocked,
  isPassableTerrain,
  isPreparedGround,
  mobileStats,
  type CompiledDataLike,
} from '@terra/sim';
import type { MouseCursorHoverTarget } from '../../../core/input/MouseCursorStateMachine';
import {
  collectEntitiesFromView,
  findHostileOrFaunaTargetOnTile,
  findOwnCombatUnitsOnTile,
} from '../../army/parts/armyEntityQueries';
import type { ArmyOrdersController } from '../../army/ArmyOrdersController';
import type { LandfallController, SelectedEntityView } from '../../landfall/selection';
import { inspectDepositAt, isArmyCombatUnitKind, resolveTileIndex } from '../../landfall/selectionHelpers';

export interface ClassifyCursorHoverInput {
  readonly q: number;
  readonly r: number;
  readonly view: unknown;
  readonly fallbackTiles?: unknown;
  readonly simData?: CompiledDataLike | null;
  readonly ownerColonyIndex: number;
  readonly spectator: boolean;
  readonly combatEnabled: boolean;
  readonly landfall?: LandfallController | null;
  readonly armyOrders?: ArmyOrdersController | null;
}

export interface ClassifiedCursorSelection {
  readonly hasSelectedMovableUnit: boolean;
  readonly hasSelectedArmedUnit: boolean;
  readonly selectedIds: ReadonlySet<number>;
  readonly primarySelected: SelectedEntityView | null;
}

export function classifyCursorSelection(
  landfall: LandfallController | null | undefined,
  armyOrders: ArmyOrdersController | null | undefined,
  combatEnabled: boolean,
): ClassifiedCursorSelection {
  const armyIds = armyOrders?.getSelectedEntityIds() ?? [];
  const primary = landfall?.getSelectedEntity() ?? null;
  const selectedIds = new Set<number>(armyIds);
  if (primary) selectedIds.add(primary.entityId);

  const hasSelectedMovableUnit = armyIds.length > 0 || Boolean(primary?.isMovable);
  const hasSelectedArmedUnit =
    armyIds.length > 0 ||
    Boolean(primary && (isArmyCombatUnitKind(primary.kind) || (combatEnabled && primary.kind === ENTITY_KIND.hq)));

  return {
    hasSelectedMovableUnit,
    hasSelectedArmedUnit,
    selectedIds,
    primarySelected: primary,
  };
}

function resolveViewTileIndex(rawView: unknown, fallbackTiles: unknown, q: number, r: number): number {
  const v = (rawView && typeof rawView === 'object' ? rawView : {}) as Record<string, unknown>;
  const tiles = (v.tiles ?? fallbackTiles) as Record<string, unknown> | undefined;
  const planetRadius = (v.planet as { radius?: number } | undefined)?.radius;
  if (tiles && typeof tiles === 'object') {
    return resolveTileIndex(tiles, planetRadius, q, r);
  }
  if (typeof planetRadius === 'number' && planetRadius >= 0) {
    return hexIndex(planetRadius).indexOf(q, r);
  }
  return -1;
}

function resolveAtlasSectorRadius(rawView: unknown): number {
  if (!rawView || typeof rawView !== 'object') return 0;
  const blobs = (rawView as { blobs?: Record<string, unknown> }).blobs;
  const rawAtlas = blobs?.atlas as { value?: unknown } | undefined;
  const atlas = (rawAtlas && typeof rawAtlas === 'object' && 'value' in rawAtlas ? rawAtlas.value : rawAtlas) as
    | { sectorRadius?: unknown }
    | undefined;
  const r = Number(atlas?.sectorRadius ?? 0);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

function resolveAllowedSectors(
  rawView: unknown,
  ownerColonyIndex: number,
  sel: ClassifiedCursorSelection,
  armyIds: readonly number[],
  sectorRadius: number,
): ReadonlySet<string> | null {
  if (sectorRadius <= 0 || !sel.hasSelectedMovableUnit) return null;
  const allowed = new Set<string>();
  if (armyIds.length > 0) {
    const rows = collectEntitiesFromView(rawView, ownerColonyIndex);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of armyIds) {
      const row = byId.get(id);
      if (row) allowed.add(globalTileToSector(Math.round(row.q), Math.round(row.r), sectorRadius).sectorId);
    }
  }
  if (sel.primarySelected?.isMovable && (armyIds.length === 0 || allowed.size === 0)) {
    allowed.add(
      globalTileToSector(Math.round(sel.primarySelected.q), Math.round(sel.primarySelected.r), sectorRadius).sectorId,
    );
  }
  return allowed.size > 0 ? allowed : null;
}

function isTileBlockedByWreck(
  rawView: unknown,
  fallbackTiles: unknown,
  q: number,
  r: number,
  wrecks: ReadonlySet<number>,
): boolean {
  if (wrecks.size === 0) return false;
  const idx = resolveViewTileIndex(rawView, fallbackTiles, q, r);
  return idx >= 0 && wrecks.has(idx);
}

function isTilePassableForSelection(
  rawView: unknown,
  fallbackTiles: unknown,
  q: number,
  r: number,
  primary: SelectedEntityView | null,
  hasArmySquad: boolean,
  simData?: CompiledDataLike | null,
  wrecks: ReadonlySet<number> = getWreckTileSet(rawView as Record<string, unknown> | undefined),
  sectorRadius = 0,
  allowedSectors: ReadonlySet<string> | null = null,
): boolean {
  if (allowedSectors && sectorRadius > 0 && !allowedSectors.has(globalTileToSector(q, r, sectorRadius).sectorId)) {
    return false;
  }
  if (isTileBlockedByWreck(rawView, fallbackTiles, q, r, wrecks)) return false;

  const v = (rawView && typeof rawView === 'object' ? rawView : {}) as Record<string, unknown>;
  const tiles = (v.tiles ?? fallbackTiles) as Record<string, unknown> | undefined;
  if (!tiles || typeof tiles !== 'object') return true;

  const planetRadius = (v.planet as { radius?: number } | undefined)?.radius;
  const idx = resolveTileIndex(tiles, planetRadius, q, r);
  if (idx < 0 || wrecks.has(idx)) return false;

  const terrainArr = tiles.terrain as ArrayLike<number> | undefined;
  const prepArr = tiles.prep as ArrayLike<number> | undefined;
  const depositArr = tiles.deposit as ArrayLike<number> | undefined;
  if (!terrainArr) return true;

  const terrain = Number(terrainArr[idx] ?? TERRAIN.flat);
  const prep = Number(prepArr?.[idx] ?? PREP.wild);
  const deposit = Number(depositArr?.[idx] ?? DEPOSIT.none);

  if (!isPassableTerrain(terrain, prep)) return false;
  if (terrain === TERRAIN.rock && !isPreparedGround(prep)) return false;

  const profile = primary && simData ? mobileStats(primary.kind, simData)?.profile : undefined;
  if (profile === 'hover') {
    return true;
  }

  const isWorkerSelected = !hasArmySquad && (primary?.kind === ENTITY_KIND.worker || profile === 'worker');
  if (isWorkerSelected) {
    return terrain !== TERRAIN.shallow && deposit === DEPOSIT.none;
  }
  return !isGroundMoveBlocked(terrain, deposit);
}

function hasPassableDepositNeighbor(
  rawView: unknown,
  fallbackTiles: unknown,
  q: number,
  r: number,
  primary: SelectedEntityView | null,
  landfall: LandfallController | null | undefined,
  simData?: CompiledDataLike | null,
  wrecks?: ReadonlySet<number>,
  sectorRadius = 0,
  allowedSectors: ReadonlySet<string> | null = null,
): boolean {
  for (const [dq, dr] of HEX_DIRS) {
    const nq = q + dq;
    const nr = r + dr;
    if (landfall?.isTileBlockedByBuilding(nq, nr)) continue;
    if (
      isTilePassableForSelection(
        rawView,
        fallbackTiles,
        nq,
        nr,
        primary,
        false,
        simData,
        wrecks,
        sectorRadius,
        allowedSectors,
      )
    ) {
      return true;
    }
  }
  return false;
}

function classifyOwnEntityHover(
  q: number,
  r: number,
  view: unknown,
  ownerColonyIndex: number,
  spectator: boolean,
  landfall: LandfallController | null | undefined,
  sel: ClassifiedCursorSelection,
): MouseCursorHoverTarget | null {
  const ownCombatOnTile = !spectator ? findOwnCombatUnitsOnTile(view, ownerColonyIndex, q, r) : [];
  const pickedOwn = landfall?.pickEntityAt(q, r) ?? null;
  if (pickedOwn) {
    const isSoleAlreadySelected =
      sel.selectedIds.size === 1 &&
      sel.selectedIds.has(pickedOwn.entityId) &&
      ownCombatOnTile.every((u) => sel.selectedIds.has(u.id));
    return isSoleAlreadySelected ? 'ownSelectedSelf' : 'ownSelectable';
  }
  if (!spectator && ownCombatOnTile.length > 0) {
    const isSoleAlreadySelected =
      sel.selectedIds.size === 1 &&
      ownCombatOnTile.every((u) => sel.selectedIds.has(u.id));
    return isSoleAlreadySelected ? 'ownSelectedSelf' : 'ownSelectable';
  }
  return null;
}

function classifyDepositHover(
  q: number,
  r: number,
  view: unknown,
  fallbackTiles: unknown,
  simData: CompiledDataLike | null | undefined,
  landfall: LandfallController | null | undefined,
  hasArmySquad: boolean,
  sel: ClassifiedCursorSelection,
  wrecks: ReadonlySet<number>,
  sectorRadius: number,
  allowedSectors: ReadonlySet<string> | null,
): MouseCursorHoverTarget | null {
  const dep = inspectDepositAt(view, fallbackTiles, q, r);
  if (!dep || dep.deposit <= 0) return null;
  if (!sel.hasSelectedMovableUnit) return 'deposit';
  if (sel.primarySelected && simData && mobileStats(sel.primarySelected.kind, simData)?.profile === 'hover') {
    if (allowedSectors && sectorRadius > 0 && !allowedSectors.has(globalTileToSector(q, r, sectorRadius).sectorId)) {
      return 'impassableGround';
    }
    return 'passableGround';
  }
  const canApproachDeposit =
    (sel.primarySelected?.kind === ENTITY_KIND.worker || sel.primarySelected?.kind === ENTITY_KIND.hq) &&
    !hasArmySquad &&
    hasPassableDepositNeighbor(
      view,
      fallbackTiles,
      q,
      r,
      sel.primarySelected,
      landfall,
      simData,
      wrecks,
      sectorRadius,
      allowedSectors,
    );
  return canApproachDeposit ? 'deposit' : 'impassableGround';
}

export function classifyCursorHoverTile(input: ClassifyCursorHoverInput): {
  hoverTarget: MouseCursorHoverTarget;
  hasSelectedMovableUnit: boolean;
  hasSelectedArmedUnit: boolean;
} {
  const { q, r, view, fallbackTiles, simData, ownerColonyIndex, spectator, combatEnabled, landfall, armyOrders } = input;
  const sel = classifyCursorSelection(landfall, armyOrders, combatEnabled);
  const result = (hoverTarget: MouseCursorHoverTarget) => ({
    hoverTarget,
    hasSelectedMovableUnit: sel.hasSelectedMovableUnit,
    hasSelectedArmedUnit: sel.hasSelectedArmedUnit,
  });

  if (!Number.isFinite(q) || !Number.isFinite(r)) return result('none');

  if (!spectator && combatEnabled && sel.hasSelectedArmedUnit) {
    const hostile =
      armyOrders?.findHostileTargetAt(q, r) ?? findHostileOrFaunaTargetOnTile(view, ownerColonyIndex, q, r);
    if (hostile) return result('hostile');
  }

  const ownHit = classifyOwnEntityHover(q, r, view, ownerColonyIndex, spectator, landfall, sel);
  if (ownHit) return result(ownHit);

  const wrecks = getWreckTileSet(view as Record<string, unknown> | undefined);
  if (landfall?.isTileBlockedByBuilding(q, r) || isTileBlockedByWreck(view, fallbackTiles, q, r, wrecks)) {
    return result('impassableGround');
  }

  const armyIds = armyOrders?.getSelectedEntityIds() ?? [];
  const hasArmySquad = armyIds.length > 0;
  const sectorRadius = resolveAtlasSectorRadius(view);
  const allowedSectors = resolveAllowedSectors(view, ownerColonyIndex, sel, armyIds, sectorRadius);
  const depHit = classifyDepositHover(
    q,
    r,
    view,
    fallbackTiles,
    simData,
    landfall,
    hasArmySquad,
    sel,
    wrecks,
    sectorRadius,
    allowedSectors,
  );
  if (depHit) return result(depHit);

  const passable = isTilePassableForSelection(
    view,
    fallbackTiles,
    q,
    r,
    sel.primarySelected,
    hasArmySquad,
    simData,
    wrecks,
    sectorRadius,
    allowedSectors,
  );
  return result(passable ? 'passableGround' : 'impassableGround');
}
