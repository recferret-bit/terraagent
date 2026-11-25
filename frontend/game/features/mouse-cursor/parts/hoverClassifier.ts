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
import { createMapVisibility, isMapTileExplored } from '../../../maps/visibility';
import type { ClientTiles, ClientView, EntityRow } from '../../../store/replica/viewCodec';
import {
  collectEntitiesFromView,
  findHostileOrFaunaTargetOnTile,
  findOwnCombatUnitsOnTile,
  isEntityAlive,
  isTargetCoveringTile,
} from '../../army/parts/armyEntityQueries';
import type { ArmyOrdersController } from '../../army/ArmyOrdersController';
import type { LandfallController, SelectedEntityView } from '../../landfall/selection';
import {
  BLDG_META,
  inspectDepositAt,
  isArmyCombatUnitKind,
  isHiveKind,
  resolveTileIndex,
} from '../../landfall/selectionHelpers';

export interface ClassifyCursorHoverInput {
  readonly q: number;
  readonly r: number;
  readonly entityId?: number;
  readonly view: unknown;
  readonly fallbackTiles?: unknown;
  readonly simData?: CompiledDataLike | null;
  readonly ownerColonyIndex: number;
  readonly spectator: boolean;
  readonly spectatorAllVision?: boolean;
  readonly fullVision?: boolean;
  readonly shiftKey?: boolean;
  readonly combatEnabled: boolean;
  readonly landfall?: LandfallController | null;
  readonly armyOrders?: ArmyOrdersController | null;
}

export interface ClassifiedCursorSelection {
  readonly hasSelectedMovableUnit: boolean;
  readonly hasSelectedArmedUnit: boolean;
  readonly canToggleSelectedSelf: boolean;
  readonly hasWorkerOrHqHarvester: boolean;
  readonly hasNonHarvesterVehicle: boolean;
  readonly selectedIds: ReadonlySet<number>;
  readonly primarySelected: SelectedEntityView | null;
}

export function classifyCursorSelection(
  landfall: LandfallController | null | undefined,
  armyOrders: ArmyOrdersController | null | undefined,
  combatEnabled: boolean,
  rawView?: unknown,
  ownerColonyIndex = 0,
): ClassifiedCursorSelection {
  const armyIds = armyOrders?.getSelectedEntityIds() ?? [];
  const landfallMultiIds =
    (landfall as { getSelectedEntityIds?: () => readonly number[] } | null | undefined)?.getSelectedEntityIds?.() ?? [];
  const primary = landfall?.getSelectedEntity() ?? null;
  const selectedIds = new Set<number>([...armyIds, ...landfallMultiIds]);
  if (primary) selectedIds.add(primary.entityId);

  let hasSelectedMovableUnit = armyIds.length > 0 || Boolean(primary?.isMovable);
  let hasSelectedArmedUnit =
    armyIds.length > 0 ||
    Boolean(
      primary &&
        (isArmyCombatUnitKind(primary.kind) ||
          primary.kind === ENTITY_KIND.autocannon ||
          primary.kind === ENTITY_KIND.laserTower ||
          (combatEnabled && primary.kind === ENTITY_KIND.hq)),
    );
  let hasWorkerOrHqHarvester = Boolean(
    primary && (primary.kind === ENTITY_KIND.worker || primary.kind === ENTITY_KIND.hq),
  );
  let hasNonHarvesterVehicle = armyIds.length > 0 || Boolean(primary && isArmyCombatUnitKind(primary.kind));

  if (selectedIds.size > 1 && rawView) {
    const byId = new Map(collectEntitiesFromView(rawView, ownerColonyIndex).map((r) => [r.id, r]));
    for (const id of selectedIds) {
      const row = byId.get(id);
      if (!row) continue;
      if (row.kind === ENTITY_KIND.worker || row.kind === ENTITY_KIND.hq || isArmyCombatUnitKind(row.kind)) {
        hasSelectedMovableUnit = true;
      }
      if (isArmyCombatUnitKind(row.kind) || (combatEnabled && row.kind === ENTITY_KIND.hq)) {
        hasSelectedArmedUnit = true;
      }
      if (row.kind === ENTITY_KIND.worker || row.kind === ENTITY_KIND.hq) {
        hasWorkerOrHqHarvester = true;
      }
      if (isArmyCombatUnitKind(row.kind)) {
        hasNonHarvesterVehicle = true;
      }
    }
  }

  const canToggleSelectedSelf =
    selectedIds.size > 1 ||
    armyIds.length > 0 ||
    Boolean(primary?.isUnit && (isArmyCombatUnitKind(primary.kind) || primary.kind === ENTITY_KIND.worker || primary.kind === ENTITY_KIND.hq));

  return {
    hasSelectedMovableUnit,
    hasSelectedArmedUnit,
    canToggleSelectedSelf,
    hasWorkerOrHqHarvester,
    hasNonHarvesterVehicle,
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

function buildVisibilityCheck(
  rawView: unknown,
  fallbackTiles: unknown,
  ownerColonyIndex: number,
  spectatorAllVision: boolean,
  fullVision: boolean,
  simData?: CompiledDataLike | null,
): (q: number, r: number) => boolean {
  if (fullVision) return () => true;
  if (!rawView || typeof rawView !== 'object') return () => true;
  const v = rawView as ClientView & { planet?: { radius?: number }; blobs?: Record<string, unknown> };
  const tiles = (v.tiles ?? fallbackTiles) as ClientTiles | undefined;
  const hasFogData = Boolean(
    tiles?.explored || tiles?.exploredByColony || v.blobs?.combatVision,
  );
  if (!hasFogData) return () => true;
  const radius = v.planet?.radius ?? 16;
  return createMapVisibility({
    tiles: tiles ?? null,
    ownColonySlot: ownerColonyIndex,
    spectatorAllVision,
    fullVision,
    radius,
    clientView: v,
    simData: simData ?? undefined,
  });
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
  sectorRadius: number,
): ReadonlySet<string> | null {
  if (sectorRadius <= 0 || !sel.hasSelectedMovableUnit) return null;
  const allowed = new Set<string>();
  const rows = collectEntitiesFromView(rawView, ownerColonyIndex);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of sel.selectedIds) {
    const row = byId.get(id);
    if (row) allowed.add(globalTileToSector(Math.round(row.q), Math.round(row.r), sectorRadius).sectorId);
  }
  if (allowed.size === 0 && sel.primarySelected?.isMovable) {
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
  sel: ClassifiedCursorSelection,
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

  if (!sel.hasSelectedMovableUnit) {
    return terrain !== TERRAIN.shallow;
  }

  const profile = sel.primarySelected && simData ? mobileStats(sel.primarySelected.kind, simData)?.profile : undefined;
  if (profile === 'hover' && !sel.hasNonHarvesterVehicle) {
    return true;
  }

  const isWorkerOnly =
    !sel.hasNonHarvesterVehicle &&
    (sel.primarySelected?.kind === ENTITY_KIND.worker ||
      profile === 'worker' ||
      (!sel.primarySelected && sel.hasWorkerOrHqHarvester));
  if (isWorkerOnly) {
    return terrain !== TERRAIN.shallow && deposit === DEPOSIT.none;
  }
  return !isGroundMoveBlocked(terrain, deposit);
}

function hasPassableDepositNeighbor(
  rawView: unknown,
  fallbackTiles: unknown,
  q: number,
  r: number,
  sel: ClassifiedCursorSelection,
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
        sel,
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

function classifyNonOwnBlockingEntity(
  q: number,
  r: number,
  view: unknown,
  ownerColonyIndex: number,
  isVisible: (tq: number, tr: number) => boolean,
  pickedEntityId?: number,
): EntityRow | null {
  const rows = collectEntitiesFromView(view, ownerColonyIndex);
  for (const row of rows) {
    if (!isEntityAlive(row) || row.owner === ownerColonyIndex) continue;
    const directPick = typeof pickedEntityId === 'number' && pickedEntityId > 0 && row.id === pickedEntityId;
    if (!directPick && !isTargetCoveringTile(row, q, r)) continue;
    const staticStructure = Boolean(BLDG_META[row.kind]) || isHiveKind(row.kind) || row.kind === ENTITY_KIND.tradeHub;
    if (!staticStructure && !isVisible(Math.round(row.q), Math.round(row.r)) && !isVisible(q, r)) continue;
    if (staticStructure && !isVisible(q, r) && !isVisible(Math.round(row.q), Math.round(row.r)) && row.kind !== ENTITY_KIND.tradeHub) {
      // Unspotted static structures still only block if visible in live sight or explored
      continue;
    }
    return row;
  }
  return null;
}

function classifyOwnEntityHover(
  q: number,
  r: number,
  view: unknown,
  ownerColonyIndex: number,
  spectator: boolean,
  shiftKey: boolean,
  attackMoveArmed: boolean,
  landfall: LandfallController | null | undefined,
  sel: ClassifiedCursorSelection,
  pickedEntityId?: number,
): MouseCursorHoverTarget | null {
  const ownCombatOnTile = !spectator ? findOwnCombatUnitsOnTile(view, ownerColonyIndex, q, r, pickedEntityId) : [];
  const pickedOwn = landfall?.pickEntityAt(q, r, pickedEntityId) ?? null;
  if (pickedOwn) {
    if (
      !pickedOwn.isUnit &&
      ((shiftKey && sel.hasSelectedMovableUnit && !sel.selectedIds.has(pickedOwn.entityId)) ||
        (attackMoveArmed && sel.hasSelectedArmedUnit && ownCombatOnTile.length === 0))
    ) {
      return 'impassableGround';
    }
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
  sel: ClassifiedCursorSelection,
  wrecks: ReadonlySet<number>,
  sectorRadius: number,
  allowedSectors: ReadonlySet<string> | null,
): MouseCursorHoverTarget | null {
  const dep = inspectDepositAt(view, fallbackTiles, q, r);
  if (!dep || dep.deposit <= 0) return null;
  const v = (view && typeof view === 'object' ? view : {}) as Record<string, unknown>;
  const tiles = (v.tiles ?? fallbackTiles) as Record<string, unknown> | undefined;
  const idx = resolveViewTileIndex(view, fallbackTiles, q, r);
  const terrainArr = tiles?.terrain as ArrayLike<number> | undefined;
  const prepArr = tiles?.prep as ArrayLike<number> | undefined;
  if (idx >= 0 && terrainArr) {
    const depTerrain = Number(terrainArr[idx] ?? TERRAIN.flat);
    const depPrep = Number(prepArr?.[idx] ?? PREP.wild);
    if (!isPassableTerrain(depTerrain, depPrep) || (depTerrain === TERRAIN.rock && !isPreparedGround(depPrep))) {
      return 'impassableGround';
    }
  }
  if (!sel.hasSelectedMovableUnit) return 'deposit';
  if (sel.primarySelected && simData && mobileStats(sel.primarySelected.kind, simData)?.profile === 'hover' && !sel.hasNonHarvesterVehicle) {
    if (allowedSectors && sectorRadius > 0 && !allowedSectors.has(globalTileToSector(q, r, sectorRadius).sectorId)) {
      return 'impassableGround';
    }
    return 'passableGround';
  }
  const canApproachDeposit =
    sel.hasWorkerOrHqHarvester &&
    !sel.hasNonHarvesterVehicle &&
    hasPassableDepositNeighbor(
      view,
      fallbackTiles,
      q,
      r,
      sel,
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
  canToggleSelectedSelf: boolean;
} {
  const {
    q, r, view, fallbackTiles, simData, ownerColonyIndex, spectator,
    spectatorAllVision = false, fullVision = false, shiftKey = false,
    combatEnabled, landfall, armyOrders,
  } = input;
  const sel = classifyCursorSelection(landfall, armyOrders, combatEnabled, view, ownerColonyIndex);
  const result = (hoverTarget: MouseCursorHoverTarget) => ({
    hoverTarget,
    hasSelectedMovableUnit: sel.hasSelectedMovableUnit,
    hasSelectedArmedUnit: sel.hasSelectedArmedUnit,
    canToggleSelectedSelf: sel.canToggleSelectedSelf,
  });

  if (!Number.isFinite(q) || !Number.isFinite(r)) return result('none');

  const isVisible = buildVisibilityCheck(view, fallbackTiles, ownerColonyIndex, spectatorAllVision, fullVision, simData);

  if (!spectator) {
    const rawHostile =
      armyOrders?.findHostileTargetAt(q, r, input.entityId) ??
      findHostileOrFaunaTargetOnTile(view, ownerColonyIndex, q, r, input.entityId);
    if (rawHostile && (isVisible(Math.round(rawHostile.q), Math.round(rawHostile.r)) || isVisible(q, r))) {
      return result(combatEnabled && sel.hasSelectedArmedUnit ? 'hostile' : 'impassableGround');
    }
  }

  const attackMoveArmed = Boolean(armyOrders?.isAttackMoveArmed());
  const ownHit = classifyOwnEntityHover(q, r, view, ownerColonyIndex, spectator, shiftKey, attackMoveArmed, landfall, sel, input.entityId);
  if (ownHit) return result(ownHit);

  if (!spectator && classifyNonOwnBlockingEntity(q, r, view, ownerColonyIndex, isVisible, input.entityId)) {
    return result('impassableGround');
  }

  const wrecks = getWreckTileSet(view as Record<string, unknown> | undefined);
  if (landfall?.isTileBlockedByBuilding(q, r) || isTileBlockedByWreck(view, fallbackTiles, q, r, wrecks)) {
    return result('impassableGround');
  }

  const sectorRadius = resolveAtlasSectorRadius(view);
  const allowedSectors = resolveAllowedSectors(view, ownerColonyIndex, sel, sectorRadius);
  const tileIdx = resolveViewTileIndex(view, fallbackTiles, q, r);
  const tilesObj = ((view as { tiles?: ClientTiles } | null | undefined)?.tiles ?? fallbackTiles) as ClientTiles | undefined;
  const isKnown =
    fullVision ||
    isVisible(q, r) ||
    (tileIdx >= 0 &&
      isMapTileExplored({ tiles: tilesObj ?? null, ownColonySlot: ownerColonyIndex, spectatorAllVision, fullVision } as never, tileIdx));
  if (!isKnown) {
    const outOfSector = Boolean(allowedSectors && sectorRadius > 0 && !allowedSectors.has(globalTileToSector(q, r, sectorRadius).sectorId));
    return result(!sel.hasSelectedMovableUnit || tileIdx < 0 || outOfSector ? 'impassableGround' : 'passableGround');
  }

  const depHit = classifyDepositHover(q, r, view, fallbackTiles, simData, landfall, sel, wrecks, sectorRadius, allowedSectors);
  if (depHit) return result(depHit);

  const passable = isTilePassableForSelection(view, fallbackTiles, q, r, sel, simData, wrecks, sectorRadius, allowedSectors);
  return result(passable ? 'passableGround' : 'impassableGround');
}
