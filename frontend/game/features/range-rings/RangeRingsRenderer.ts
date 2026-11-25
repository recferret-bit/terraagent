import {
  HEX_WATER_LEVEL,
  tileAt,
  type HexTerrain,
} from '@terra/render/planets/hex';
import {
  InstancedRangeRings,
  type RangeRingDescriptor,
  type RangeRingInput,
  type RingHeightSampler,
} from '@terra/render/visuals/rings';
import { ENTITY_STATE, hexDistance, type CompiledDataLike } from '@terra/sim';
import { isTypingTarget } from '../shared/hotkeys';
import { ownColonyIndex } from '../shared/colony';
import { waterTileTest } from '../shared/hexTiles3d';
import type { FeatureContext, GameView, RendererInstance } from '../../core/registry/types';
import type { PlacementGhostState } from '../construction-menu/PlacementGhost';
import { RingLabelsOverlay } from './RingLabelsOverlay';
import {
  computeGhostWorldPos,
  extractRingEntities,
  pushOwnEntityRings,
  type NormalizedRingEntity,
} from './ringEntities';
import { computeEntityWorldPos } from './ringPosition';
import {
  rangeRingsData,
  resolveEntityRingSpec,
  resolveGhostTurretRingSpec,
} from './ringSpecs';

export interface RangeRingsService {
  readonly rings: InstancedRangeRings;
  getActiveRings(): ReadonlyArray<RangeRingDescriptor>;
  setAltPressed(pressed: boolean): void;
  isAltPressed(): boolean;
  setHoveredEntityId(entityId: number | null): void;
  getHoveredEntityId(): number | null;
  setHoveredTile(tile: { q: number; r: number } | null): void;
  getHoveredTile(): { q: number; r: number } | null;
  setSelectedEntityIds(entityIds: readonly number[]): void;
  getSelectedEntityIds(): ReadonlyArray<number>;
  update(view?: GameView, dt?: number): void;
}

interface TerrainAndGhostServices {
  hexTerrain?: HexTerrain | null;
  getPlacementGhostState?: () => PlacementGhostState | null;
  getGhostState?: () => PlacementGhostState | null;
  armyOrders?: { getSelectedEntityIds?(): readonly number[] };
}

export class RangeRingsController implements RangeRingsService, RendererInstance {
  readonly rings: InstancedRangeRings;
  private readonly labels: RingLabelsOverlay;
  private altPressed = false;
  private hoveredEntityId: number | null = null;
  private hoveredTile: { q: number; r: number } | null = null;
  private pendingHoverPointer: { x: number; y: number } | null = null;
  private selectedEntityIds: number[] = [];
  private fallbackSelectedId: number | null = null;
  private latestView: GameView | undefined;
  private groundTerrain: ArrayLike<number> | undefined;
  private groundRadius: number | undefined;
  private lastTilesRef: unknown = null;
  private terrainRevision = 0;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly ctx: FeatureContext) {
    this.rings = new InstancedRangeRings(ctx.services.scene3d?.scene ?? null);
    this.labels = new RingLabelsOverlay(ctx);
    this.bindInputListeners();
    this.installLandfallTurretFallback();
  }

  private bindInputListeners(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const canvas = (this.ctx.services.surface ?? this.ctx.services.canvas) as HTMLElement | null | undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key === 'Alt' || e.altKey) {
        this.altPressed = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || !e.altKey) {
        this.altPressed = false;
      }
    };
    const onBlur = () => {
      this.altPressed = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (canvas && e.target && e.target !== canvas) return;
      if (((e.buttons ?? 0) & 5) !== 0) {
        this.pendingHoverPointer = null;
        this.hoveredTile = null;
        return;
      }
      this.pendingHoverPointer = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointermove', onPointerMove);
    this.cleanups.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onPointerMove);
    });
  }

  private installLandfallTurretFallback(): void {
    const lf = this.ctx.services.landfall;
    if (!lf) return;
    const origSelect = lf.selectEntity.bind(lf);
    const origDeselect = lf.deselect.bind(lf);
    const origSelectHq = lf.selectHq.bind(lf);
    const origGetSelectedId = lf.getSelectedEntityId.bind(lf);
    const origLeftClick = lf.handleLeftClick.bind(lf);

    lf.selectEntity = (entityId: number | null): number | null => {
      this.fallbackSelectedId = null;
      const res = origSelect(entityId);
      if (entityId !== null && res !== entityId) {
        const view = this.resolveCurrentView();
        const own = ownColonyIndex(this.ctx.services);
        const hit = extractRingEntities(view).find((e) => e.id === entityId && e.owner === own && e.hp > 0);
        if (hit) {
          origDeselect();
          this.fallbackSelectedId = entityId;
          return entityId;
        }
      }
      return res;
    };
    lf.deselect = (): void => {
      this.fallbackSelectedId = null;
      origDeselect();
    };
    lf.selectHq = (): number | null => {
      this.fallbackSelectedId = null;
      return origSelectHq();
    };
    lf.getSelectedEntityId = (): number | null => origGetSelectedId() ?? this.fallbackSelectedId;
    lf.handleLeftClick = (q: number, r: number, shiftKey = false): boolean => {
      this.fallbackSelectedId = null;
      const ok = origLeftClick(q, r, shiftKey);
      if (ok) return true;
      const view = this.resolveCurrentView();
      const own = ownColonyIndex(this.ctx.services);
      const hit = extractRingEntities(view).find(
        (e) => e.owner === own && e.hp > 0 && Math.round(e.x) === q && Math.round(e.y) === r,
      );
      if (hit) {
        this.fallbackSelectedId = hit.id;
        return true;
      }
      return false;
    };

    this.cleanups.push(() => {
      lf.selectEntity = origSelect;
      lf.deselect = origDeselect;
      lf.selectHq = origSelectHq;
      lf.getSelectedEntityId = origGetSelectedId;
      lf.handleLeftClick = origLeftClick;
    });
  }

  private resolveCurrentView(view?: GameView): GameView | undefined {
    return (
      view ??
      this.latestView ??
      this.ctx.services.getView?.() ??
      (this.ctx.services.store?.latest as GameView | undefined)
    );
  }

  private trackTerrainUpdates(view: GameView | undefined): void {
    const v = view as {
      tiles?: { terrain?: ArrayLike<number> };
      planet?: { radius?: number };
      sim?: { view?: { tiles?: { terrain?: ArrayLike<number> }; planet?: { radius?: number } } };
    } | undefined;
    const incomingTiles = v?.tiles ?? v?.sim?.view?.tiles;
    const incomingRadius = v?.planet?.radius ?? v?.sim?.view?.planet?.radius;
    if (typeof incomingRadius === 'number') this.groundRadius = incomingRadius;
    if (incomingTiles?.terrain && incomingTiles !== this.lastTilesRef) {
      this.lastTilesRef = incomingTiles;
      this.groundTerrain = incomingTiles.terrain;
      this.terrainRevision++;
    }
  }

  private resolveSurfaceSampler(): RingHeightSampler | null {
    const services = this.ctx.services as TerrainAndGhostServices;
    const hexTerrain = services.hexTerrain ?? null;
    const s3Height = this.ctx.services.scene3d?.heightAt;
    if (!hexTerrain && !s3Height) return null;

    const rawHeight: RingHeightSampler = hexTerrain
      ? (wx, wz) => hexTerrain.heightAt(wx, wz)
      : (wx, wz) => s3Height!(wx, wz);

    const isWater = waterTileTest(this.groundTerrain, this.groundRadius);
    const radius = this.groundRadius;
    if (!isWater || typeof radius !== 'number') return rawHeight;

    return (wx, wz) => {
      const y = rawHeight(wx, wz);
      const hit = tileAt(radius, wx, wz);
      return hit && isWater(hit.q, hit.r) ? Math.max(y, HEX_WATER_LEVEL) : y;
    };
  }

  getActiveRings(): ReadonlyArray<RangeRingDescriptor> {
    return this.rings.getActiveRings();
  }

  setAltPressed(pressed: boolean): void {
    this.altPressed = pressed;
    if (this.latestView) this.update(this.latestView, 0);
  }

  isAltPressed(): boolean {
    return this.altPressed;
  }

  setHoveredEntityId(entityId: number | null): void {
    this.hoveredEntityId = entityId;
    if (this.latestView) this.update(this.latestView, 0);
  }

  getHoveredEntityId(): number | null {
    return this.hoveredEntityId;
  }

  setHoveredTile(tile: { q: number; r: number } | null): void {
    this.hoveredTile = tile;
    if (this.latestView) this.update(this.latestView, 0);
  }

  getHoveredTile(): { q: number; r: number } | null {
    return this.hoveredTile;
  }

  setSelectedEntityIds(entityIds: readonly number[]): void {
    this.selectedEntityIds = [...entityIds];
    if (this.latestView) this.update(this.latestView, 0);
  }

  getSelectedEntityIds(): ReadonlyArray<number> {
    return this.selectedEntityIds;
  }

  private collectSelectedIdSet(): Set<number> {
    const ids = new Set<number>(this.selectedEntityIds);
    const armyIds = (this.ctx.services as TerrainAndGhostServices).armyOrders?.getSelectedEntityIds?.();
    if (armyIds) {
      for (const id of armyIds) ids.add(id);
    }
    const lfId = this.ctx.services.landfall?.getSelectedEntityId();
    if (typeof lfId === 'number') ids.add(lfId);
    if (typeof this.fallbackSelectedId === 'number') ids.add(this.fallbackSelectedId);
    return ids;
  }

  private resolveHoveredEnemy(
    entities: readonly NormalizedRingEntity[],
    ownColony: number,
    data: CompiledDataLike,
  ): NormalizedRingEntity | null {
    if (this.hoveredEntityId !== null) {
      const byId = entities.find((e) => e.id === this.hoveredEntityId && e.owner !== ownColony && e.hp > 0);
      if (byId) return byId;
    }
    if (!this.hoveredTile) return null;
    let best: NormalizedRingEntity | null = null;
    let bestDist = Infinity;
    for (const e of entities) {
      if (e.owner === ownColony || e.hp <= 0) continue;
      if (e.state === ENTITY_STATE.descending || e.state === ENTITY_STATE.inert) continue;
      const spec = resolveEntityRingSpec(e.kindOrName, data, e.weaponId);
      if (spec.weaponRangeTiles <= 0) continue;
      const d = hexDistance(e.x, e.y, this.hoveredTile.q, this.hoveredTile.r);
      if (d <= 1 && d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private pushGhostRings(inputs: RangeRingInput[], data: CompiledDataLike): void {
    const services = this.ctx.services as TerrainAndGhostServices;
    const ghost = services.getPlacementGhostState?.() ?? services.getGhostState?.() ?? null;
    if (!ghost) return;
    const ghostSpec = resolveGhostTurretRingSpec(ghost.building, data);
    if (!ghostSpec) return;
    const { worldX, groundY, worldZ } = computeGhostWorldPos(this.ctx, ghost);
    if (ghostSpec.weaponRangeTiles > 0) {
      inputs.push({
        kind: 'ghostWeapon',
        radiusTiles: ghostSpec.weaponRangeTiles,
        worldX,
        groundY,
        worldZ,
      });
    }
    if (ghostSpec.viewRangeTiles > 0) {
      inputs.push({
        kind: 'viewRange',
        radiusTiles: ghostSpec.viewRangeTiles,
        worldX,
        groundY,
        worldZ,
      });
    }
  }

  update(view?: GameView, dt = 0): void {
    if (view !== undefined) this.latestView = view;
    const effView = this.resolveCurrentView(view);
    this.trackTerrainUpdates(effView);

    const data = rangeRingsData(this.ctx.flags, this.ctx.services.store);
    const ownColony = ownColonyIndex(this.ctx.services);
    const entities = extractRingEntities(effView);
    if (this.pendingHoverPointer) {
      const ptr = this.pendingHoverPointer;
      this.pendingHoverPointer = null;
      const hasEnemy = entities.some((ent) => ent.owner !== ownColony && ent.hp > 0);
      if (hasEnemy) {
        const canvas = (this.ctx.services.surface ?? this.ctx.services.canvas) as HTMLElement | null | undefined;
        const pick = this.ctx.services.pickTile?.(ptr.x, ptr.y, canvas);
        this.hoveredTile = pick ? { q: pick.q, r: pick.r } : null;
      } else {
        this.hoveredTile = null;
      }
    }
    const selectedIds = this.collectSelectedIdSet();
    const inputs: RangeRingInput[] = [];
    const emittedOwnIds = new Set<number>();

    if (this.altPressed) {
      for (const ent of entities) {
        if (ent.owner !== ownColony || ent.hp <= 0) continue;
        if (ent.state === ENTITY_STATE.descending || ent.state === ENTITY_STATE.inert) continue;
        const spec = resolveEntityRingSpec(ent.kindOrName, data, ent.weaponId);
        if (!spec.isBuilding || spec.weaponRangeTiles > 0 || selectedIds.has(ent.id)) {
          emittedOwnIds.add(ent.id);
          pushOwnEntityRings(inputs, this.ctx, ent, data);
        }
      }
    } else if (selectedIds.size > 0) {
      for (const ent of entities) {
        if (!selectedIds.has(ent.id) || emittedOwnIds.has(ent.id)) continue;
        if (ent.owner !== ownColony || ent.hp <= 0) continue;
        if (ent.state === ENTITY_STATE.descending || ent.state === ENTITY_STATE.inert) continue;
        emittedOwnIds.add(ent.id);
        pushOwnEntityRings(inputs, this.ctx, ent, data);
      }
    }

    const hoveredEnemy = this.resolveHoveredEnemy(entities, ownColony, data);
    if (hoveredEnemy) {
      const spec = resolveEntityRingSpec(hoveredEnemy.kindOrName, data, hoveredEnemy.weaponId);
      if (spec.weaponRangeTiles > 0) {
        const { worldX, groundY, worldZ } = computeEntityWorldPos(
          this.ctx, hoveredEnemy.id, spec.kind, hoveredEnemy.x, hoveredEnemy.y,
        );
        inputs.push({
          entityId: hoveredEnemy.id,
          kind: 'enemyWeapon',
          radiusTiles: spec.weaponRangeTiles,
          worldX,
          groundY,
          worldZ,
        });
      }
    }

    this.pushGhostRings(inputs, data);

    const surfaceSampler = this.resolveSurfaceSampler();
    this.rings.setHeightSampler(surfaceSampler, this.terrainRevision);
    this.rings.setRings(inputs, this.terrainRevision);
    this.rings.tick(dt);
    this.labels.update(this.rings.getActiveRings(), surfaceSampler);
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    if (this.ctx.services.rangeRings === this) {
      this.ctx.services.rangeRings = undefined;
    }
    this.labels.dispose();
    this.rings.dispose();
  }
}

export function createRangeRingsRenderer(ctx: FeatureContext): RangeRingsController {
  const ctl = new RangeRingsController(ctx);
  ctx.services.rangeRings = ctl;
  return ctl;
}
