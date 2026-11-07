import { tileXZ } from '@terra/render/planets/hex';
import {
  InstancedRangeRings,
  type RangeRingDescriptor,
  type RangeRingInput,
} from '@terra/render/visuals/rings';
import { ENTITY_STATE, hexDistance, type CompiledDataLike, type ViewEntity } from '@terra/sim';
import { isTypingTarget } from '../shared/hotkeys';
import { ownColonyIndex } from '../shared/colony';
import type { FeatureContext, GameView, RendererInstance } from '../../core/registry/types';
import { forEachEntity } from '../../store/replica/viewCodec';
import type { PlacementGhostState } from '../construction-menu/PlacementGhost';
import { computeEntityWorldPos } from './ringPosition';
import {
  normalizeRingEntityKind,
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

interface NormalizedRingEntity {
  id: number;
  kindOrName: number | string;
  kind: number;
  owner: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  state: number;
  weaponId?: string;
}

function readWeaponOverridesFromView(rawView: unknown): Record<number, string> {
  const blobs = (rawView as { blobs?: Record<string, unknown> } | null)?.blobs;
  const cw = blobs?.combatWeapons as { byEntityId?: Record<number, string> } | undefined;
  return cw?.byEntityId ?? {};
}

function extractRingEntities(view: GameView | undefined): NormalizedRingEntity[] {
  if (!view || typeof view !== 'object') return [];
  const v = view as {
    entities?: Float32Array | ViewEntity[] | Array<Record<string, unknown>>;
    count?: number;
    sim?: { view?: { entities?: Float32Array | ViewEntity[]; count?: number; blobs?: Record<string, unknown> } };
  };
  const ents = v.entities ?? v.sim?.view?.entities;
  const count = v.count ?? v.sim?.view?.count;
  const weaponOverrides = {
    ...readWeaponOverridesFromView(v.sim?.view),
    ...readWeaponOverridesFromView(v),
  };
  const out: NormalizedRingEntity[] = [];

  if (ents instanceof Float32Array) {
    forEachEntity(ents, count, (row) => {
      const ax = row.x === 0 && row.y === 0 && (row.q !== 0 || row.r !== 0) ? row.q : row.x;
      const ay = row.x === 0 && row.y === 0 && (row.q !== 0 || row.r !== 0) ? row.r : row.y;
      out.push({
        id: row.id,
        kindOrName: row.kind,
        kind: row.kind,
        owner: row.owner,
        q: row.q,
        r: row.r,
        x: ax,
        y: ay,
        hp: row.hp,
        state: row.state,
        weaponId: weaponOverrides[row.id],
      });
    });
    return out;
  }

  if (Array.isArray(ents)) {
    const n = count !== undefined ? Math.min(count, ents.length) : ents.length;
    for (let i = 0; i < n; i++) {
      const raw = ents[i] as Record<string, unknown> | undefined;
      if (!raw) continue;
      const id = Number(raw.id ?? raw.entityId ?? i + 1);
      const kindOrName = (raw.unit ?? raw.building ?? raw.species ?? raw.kind ?? 0) as number | string;
      const { kind } = normalizeRingEntityKind(kindOrName);
      const q = Number(raw.q ?? raw.x ?? 0);
      const r = Number(raw.r ?? raw.y ?? 0);
      const rx = Number(raw.x ?? q);
      const ry = Number(raw.y ?? r);
      const ax = rx === 0 && ry === 0 && (q !== 0 || r !== 0) ? q : rx;
      const ay = rx === 0 && ry === 0 && (q !== 0 || r !== 0) ? r : ry;
      const hp = Number(raw.hp ?? raw.hpMax ?? 100);
      const state = Number(raw.state ?? ENTITY_STATE.idle);
      const weaponId = typeof raw.weaponId === 'string' ? raw.weaponId : weaponOverrides[id];
      out.push({
        id,
        kindOrName,
        kind,
        owner: Number(raw.owner ?? 0),
        q,
        r,
        x: ax,
        y: ay,
        hp,
        state,
        weaponId,
      });
    }
  }
  return out;
}

function computeGhostWorldPos(
  ctx: FeatureContext,
  ghost: PlacementGhostState,
): { worldX: number; groundY: number; worldZ: number } {
  const s3 = ctx.services.scene3d;
  if (ghost.tiles && ghost.tiles.length > 0) {
    let sumX = 0;
    let sumZ = 0;
    let maxY = -Infinity;
    for (const t of ghost.tiles) {
      const p = s3 ? s3.tileToWorld(t.q, t.r) : (() => { const [wx, wz] = tileXZ(t.q, t.r); return { x: wx, y: 0, z: wz }; })();
      sumX += p.x;
      sumZ += p.z;
      if (p.y > maxY) maxY = p.y;
    }
    const n = ghost.tiles.length;
    return { worldX: sumX / n, groundY: Number.isFinite(maxY) ? maxY : 0, worldZ: sumZ / n };
  }
  const p = s3 ? s3.tileToWorld(ghost.q, ghost.r) : (() => { const [wx, wz] = tileXZ(ghost.q, ghost.r); return { x: wx, y: 0, z: wz }; })();
  return { worldX: p.x, groundY: p.y, worldZ: p.z };
}

function pushOwnEntityRings(
  out: RangeRingInput[],
  ctx: FeatureContext,
  ent: NormalizedRingEntity,
  data: CompiledDataLike,
): void {
  const spec = resolveEntityRingSpec(ent.kindOrName, data, ent.weaponId);
  const { worldX, groundY, worldZ } = computeEntityWorldPos(ctx, ent.id, spec.kind, ent.x, ent.y);
  if (spec.weaponRangeTiles > 0) {
    out.push({
      entityId: ent.id,
      kind: 'weapon',
      radiusTiles: spec.weaponRangeTiles,
      worldX,
      groundY,
      worldZ,
    });
  }
  if (spec.minRangeTiles > 0) {
    out.push({
      entityId: ent.id,
      kind: 'minRange',
      radiusTiles: spec.minRangeTiles,
      worldX,
      groundY,
      worldZ,
    });
  }
  if (spec.viewRangeTiles > 0) {
    out.push({
      entityId: ent.id,
      kind: 'viewRange',
      radiusTiles: spec.viewRangeTiles,
      worldX,
      groundY,
      worldZ,
    });
  }
}

export class RangeRingsController implements RangeRingsService, RendererInstance {
  readonly rings: InstancedRangeRings;
  private altPressed = false;
  private hoveredEntityId: number | null = null;
  private hoveredTile: { q: number; r: number } | null = null;
  private selectedEntityIds: number[] = [];
  private fallbackSelectedId: number | null = null;
  private latestView: GameView | undefined;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly ctx: FeatureContext) {
    this.rings = new InstancedRangeRings(ctx.services.scene3d?.scene ?? null);
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
      const pick = this.ctx.services.pickTile?.(e.clientX, e.clientY, canvas);
      this.hoveredTile = pick ? { q: pick.q, r: pick.r } : null;
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
    const armyIds = (this.ctx.services as { armyOrders?: { getSelectedEntityIds?(): readonly number[] } }).armyOrders?.getSelectedEntityIds?.();
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

  update(view?: GameView, dt = 0): void {
    if (view !== undefined) this.latestView = view;
    const effView = this.resolveCurrentView(view);
    const data = rangeRingsData(this.ctx.flags, this.ctx.services.store);
    const ownColony = ownColonyIndex(this.ctx.services);
    const entities = extractRingEntities(effView);
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
          this.ctx,
          hoveredEnemy.id,
          spec.kind,
          hoveredEnemy.x,
          hoveredEnemy.y,
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

    const ghost = this.ctx.services.getPlacementGhostState?.() ?? this.ctx.services.getGhostState?.() ?? null;
    if (ghost) {
      const ghostSpec = resolveGhostTurretRingSpec(ghost.building, data);
      if (ghostSpec) {
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
    }

    this.rings.setRings(inputs);
    this.rings.tick(dt);
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    if (this.ctx.services.rangeRings === this) {
      this.ctx.services.rangeRings = undefined;
    }
    this.rings.dispose();
  }
}

export function createRangeRingsRenderer(ctx: FeatureContext): RangeRingsController {
  const ctl = new RangeRingsController(ctx);
  ctx.services.rangeRings = ctl;
  return ctl;
}
