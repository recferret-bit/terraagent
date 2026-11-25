import * as THREE from 'three';
import { ENTITY_KIND } from '@terra/sim';
import type { ArmyOrdersController } from '../../army/ArmyOrdersController';
import { collectEntitiesFromView, isEntityAlive } from '../../army/parts/armyEntityQueries';
import type { MouseCursorOrchestrator } from '../../mouse-cursor/MouseCursorOrchestrator';
import type { TilePickerFn } from '../../shared/pointer';
import type { Scene3dService } from '../../shared/scene3d';
import type { LandfallController, SelectedEntityView } from '../selection';
import { BLDG_META, COMBAT_UNIT_META, isArmyCombatUnitKind } from '../selectionHelpers';

export const MARQUEE_DRAG_THRESHOLD_PX = 5;

export interface MarqueeSelectionOptions {
  readonly surface: HTMLElement;
  readonly overlayParent?: HTMLElement;
  readonly landfall: () => LandfallController | undefined;
  readonly armyOrders?: () => ArmyOrdersController | undefined;
  readonly mouseCursor?: () => MouseCursorOrchestrator | undefined;
  readonly getView?: () => unknown;
  readonly getColonyId?: () => number;
  readonly getCamera?: () => THREE.Camera | null;
  readonly scene3d?: () => Scene3dService | undefined;
  readonly pickTile?: TilePickerFn;
  readonly projectEntityClientPoint?: (entity: SelectedEntityView) => { x: number; y: number } | null;
  readonly isInputBlocked?: () => boolean;
  readonly isSpectator?: () => boolean;
}

const _projVec = new THREE.Vector3();

function collectOwnCandidateEntities(
  landfall: LandfallController | undefined,
  rawView: unknown,
  ownerColonyIndex: number,
): SelectedEntityView[] {
  const byId = new Map<number, SelectedEntityView>();
  for (const e of landfall?.getAllSelectableEntities() ?? []) {
    if (e.owner === undefined || e.owner === ownerColonyIndex) {
      byId.set(e.entityId, e);
    }
  }
  for (const row of collectEntitiesFromView(rawView, ownerColonyIndex)) {
    if (!isEntityAlive(row) || row.owner !== ownerColonyIndex || byId.has(row.id)) continue;
    if (row.kind === ENTITY_KIND.pod) continue;
    const combatMeta = COMBAT_UNIT_META[row.kind];
    const bldgMeta = BLDG_META[row.kind];
    if (!combatMeta && !bldgMeta && row.kind !== ENTITY_KIND.worker && row.kind !== ENTITY_KIND.hq) continue;
    const isUnit = Boolean(combatMeta || row.kind === ENTITY_KIND.worker || row.kind === ENTITY_KIND.hq);
    byId.set(row.id, {
      entityId: row.id,
      owner: row.owner,
      kind: row.kind,
      kindLabel: combatMeta?.label ?? bldgMeta?.label ?? (row.kind === ENTITY_KIND.hq ? 'HQ' : 'WORKER DRONE'),
      shortCode: combatMeta?.code ?? bldgMeta?.code ?? (row.kind === ENTITY_KIND.hq ? 'HQ' : 'WRK'),
      isUnit,
      isMovable: isUnit,
      tier: row.tier || 1,
      q: row.q,
      r: row.r,
      x: row.x,
      y: row.y,
      hp: row.hp,
      hpMax: row.hpMax,
      currentJob: 'idle',
      queueCount: 0,
      ...(bldgMeta ? { footprintW: bldgMeta.w, footprintD: bldgMeta.d } : {}),
    });
  }
  return [...byId.values()];
}

/**
 * Left-mouse click-and-drag marquee box selection controller.
 * Renders a chamfered Faction Plate selection rectangle while dragging with left mouse button (`button === 0`),
 * projects own alive entities into client coordinates, and strictly prioritizes mobile units over buildings.
 */
export class MarqueeSelectionController {
  readonly boxEl: HTMLElement;
  private readonly cleanups: Array<() => void> = [];
  private activePointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private curX = 0;
  private curY = 0;
  private dragging = false;
  private suppressClickUntil = -Infinity;

  constructor(private readonly opts: MarqueeSelectionOptions) {
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'ta-marquee-box';
    this.boxEl.dataset.testid = 'marquee-selection-box';
    this.boxEl.hidden = true;
    const parent = opts.overlayParent ?? opts.surface.ownerDocument?.body ?? document.body;
    parent.appendChild(this.boxEl);
    this.bindEvents();
  }

  isDragging(): boolean {
    return this.dragging;
  }

  private isBlocked(): boolean {
    return Boolean(
      this.opts.isSpectator?.() ||
        this.opts.isInputBlocked?.() ||
        this.opts.armyOrders?.()?.isAttackMoveArmed(),
    );
  }

  private updateBoxDom(): void {
    const left = Math.min(this.startX, this.curX);
    const top = Math.min(this.startY, this.curY);
    const width = Math.max(0, Math.abs(this.curX - this.startX));
    const height = Math.max(0, Math.abs(this.curY - this.startY));
    let offsetX = 0;
    let offsetY = 0;
    const cb = (this.boxEl.offsetParent as HTMLElement | null) ?? (
      this.boxEl.parentElement &&
      this.boxEl.parentElement !== document.body &&
      this.boxEl.parentElement !== document.documentElement
        ? this.boxEl.parentElement
        : null
    );
    if (cb && cb !== document.body && cb !== document.documentElement) {
      const cbRect = cb.getBoundingClientRect();
      if (cbRect.left !== 0 || cbRect.top !== 0) {
        offsetX = cbRect.left;
        offsetY = cbRect.top;
      }
    }
    this.boxEl.style.left = `${left - offsetX}px`;
    this.boxEl.style.top = `${top - offsetY}px`;
    this.boxEl.style.width = `${width}px`;
    this.boxEl.style.height = `${height}px`;
  }

  private cancelDrag(): void {
    this.activePointerId = null;
    if (this.dragging) {
      this.dragging = false;
      this.boxEl.hidden = true;
      this.opts.mouseCursor?.()?.setBoxSelecting(false);
    }
  }

  private projectEntity(entity: SelectedEntityView, rect: DOMRect, camera: THREE.Camera | null | undefined, scene3d: Scene3dService | undefined): { x: number; y: number } | null {
    if (this.opts.projectEntityClientPoint) {
      return this.opts.projectEntityClientPoint(entity);
    }
    if (!camera || !scene3d || rect.width <= 0 || rect.height <= 0) return null;
    const world = scene3d.renderedEntityGroundPosition?.(entity.entityId) ?? scene3d.tileToWorld(entity.x, entity.y);
    _projVec.set(world.x, world.y + (entity.isUnit ? 0.55 : 0.9), world.z).project(camera);
    if (!Number.isFinite(_projVec.x) || !Number.isFinite(_projVec.y) || _projVec.z < -1 || _projVec.z > 1) {
      return null;
    }
    return {
      x: rect.left + (_projVec.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-_projVec.y * 0.5 + 0.5) * rect.height,
    };
  }

  private collectEntitiesInBox(minX: number, minY: number, maxX: number, maxY: number): SelectedEntityView[] {
    const landfall = this.opts.landfall();
    const owner = this.opts.getColonyId?.() ?? landfall?.getOwnerColonyIndex() ?? 0;
    const view = this.opts.getView?.();
    const candidates = collectOwnCandidateEntities(landfall, view, owner);
    if (candidates.length === 0) return [];

    const rect = this.opts.surface.getBoundingClientRect();
    const camera = this.opts.getCamera?.() ?? null;
    const scene3d = this.opts.scene3d?.();
    const canProject3d = Boolean(this.opts.projectEntityClientPoint || (camera && scene3d && rect.width > 0 && rect.height > 0));

    if (canProject3d) {
      const pad = 6;
      return candidates.filter((e) => {
        const pt = this.projectEntity(e, rect, camera, scene3d);
        return Boolean(pt && pt.x >= minX - pad && pt.x <= maxX + pad && pt.y >= minY - pad && pt.y <= maxY + pad);
      });
    }

    if (!this.opts.pickTile) return [];
    const hitTiles = new Set<string>();
    const hitIds = new Set<number>();
    const stepX = Math.max(4, Math.min(12, Math.max(1, (maxX - minX) / 8)));
    const stepY = Math.max(4, Math.min(12, Math.max(1, (maxY - minY) / 8)));
    for (let y = minY; y <= maxY + 0.01; y += stepY) {
      for (let x = minX; x <= maxX + 0.01; x += stepX) {
        const pick = this.opts.pickTile(Math.round(x), Math.round(y), this.opts.surface);
        if (!pick) continue;
        hitTiles.add(`${pick.q},${pick.r}`);
        if (typeof pick.entityId === 'number' && pick.entityId > 0) hitIds.add(pick.entityId);
      }
    }
    const lastCorner = this.opts.pickTile(Math.round(maxX), Math.round(maxY), this.opts.surface);
    if (lastCorner) {
      hitTiles.add(`${lastCorner.q},${lastCorner.r}`);
      if (typeof lastCorner.entityId === 'number' && lastCorner.entityId > 0) hitIds.add(lastCorner.entityId);
    }

    return candidates.filter((e) => {
      if (hitIds.has(e.entityId)) return true;
      return hitTiles.has(`${Math.round(e.q)},${Math.round(e.r)}`) || hitTiles.has(`${Math.round(e.x)},${Math.round(e.y)}`);
    });
  }

  private applyBoxSelection(minX: number, minY: number, maxX: number, maxY: number, shiftKey: boolean): void {
    const landfall = this.opts.landfall();
    const army = this.opts.armyOrders?.();
    if (!landfall) return;

    const hits = this.collectEntitiesInBox(minX, minY, maxX, maxY);
    const units = hits
      .filter((e) => e.isUnit && e.kind !== ENTITY_KIND.pod)
      .sort((a, b) => a.entityId - b.entityId);
    const buildings = hits.filter((e) => !e.isUnit);

    const prevIds = shiftKey ? landfall.getSelectedEntityIds() : [];
    const prevEntities = prevIds
      .map((id) => landfall.getEntityById(id))
      .filter((e): e is SelectedEntityView => Boolean(e && e.isUnit));

    if (units.length > 0 || prevEntities.length > 0) {
      const mergedUnitIds: number[] = [];
      for (const prev of prevEntities) {
        if (!mergedUnitIds.includes(prev.entityId)) mergedUnitIds.push(prev.entityId);
      }
      for (const u of units) {
        if (!mergedUnitIds.includes(u.entityId)) mergedUnitIds.push(u.entityId);
      }
      const byId = new Map<number, SelectedEntityView>([
        ...prevEntities.map((e) => [e.entityId, e] as const),
        ...units.map((e) => [e.entityId, e] as const),
      ]);
      const armyIds = mergedUnitIds.filter((id) => {
        const ent = byId.get(id);
        return Boolean(ent && isArmyCombatUnitKind(ent.kind));
      });
      landfall.selectEntities(mergedUnitIds);
      if (army) {
        army.syncFromMarqueeUnits(armyIds, mergedUnitIds[mergedUnitIds.length - 1] ?? null);
      }
      return;
    }

    if (buildings.length > 0) {
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      const rect = this.opts.surface.getBoundingClientRect();
      const camera = this.opts.getCamera?.() ?? null;
      const scene3d = this.opts.scene3d?.();
      buildings.sort((a, b) => {
        const pa = this.projectEntity(a, rect, camera, scene3d);
        const pb = this.projectEntity(b, rect, camera, scene3d);
        const da = pa ? Math.hypot(pa.x - cx, pa.y - cy) : a.entityId;
        const db = pb ? Math.hypot(pb.x - cx, pb.y - cy) : b.entityId;
        return da - db || a.entityId - b.entityId;
      });
      army?.selectUnits([]);
      landfall.selectEntity(buildings[0]!.entityId);
      return;
    }

    if (!shiftKey) {
      army?.selectUnits([]);
      landfall.deselect();
    }
  }

  private bindEvents(): void {
    const { surface } = this.opts;
    const onPointerDown = (ev: Event) => {
      const e = ev as PointerEvent;
      if (e.button !== 0 || e.ctrlKey || e.metaKey || this.isBlocked()) return;
      const target = e.target as Node | null;
      if (target && target !== surface && !surface.contains(target)) return;
      this.activePointerId = typeof e.pointerId === 'number' ? e.pointerId : 0;
      this.startX = e.clientX ?? 0;
      this.startY = e.clientY ?? 0;
      this.curX = this.startX;
      this.curY = this.startY;
      this.dragging = false;
    };

    const onPointerMove = (ev: Event) => {
      if (this.activePointerId === null) return;
      const e = ev as PointerEvent;
      if (typeof e.pointerId === 'number' && this.activePointerId !== 0 && e.pointerId !== this.activePointerId) return;
      if (this.isBlocked()) {
        this.cancelDrag();
        return;
      }
      this.curX = e.clientX ?? this.curX;
      this.curY = e.clientY ?? this.curY;
      const dist = Math.hypot(this.curX - this.startX, this.curY - this.startY);
      if (!this.dragging && dist > MARQUEE_DRAG_THRESHOLD_PX) {
        this.dragging = true;
        this.boxEl.hidden = false;
        this.opts.mouseCursor?.()?.setBoxSelecting(true);
      }
      if (this.dragging) {
        this.updateBoxDom();
      }
    };

    const onPointerUp = (ev: Event) => {
      if (this.activePointerId === null) return;
      const e = ev as PointerEvent;
      if (typeof e.pointerId === 'number' && this.activePointerId !== 0 && e.pointerId !== this.activePointerId) return;
      const wasDragging = this.dragging;
      const endX = e.clientX ?? this.curX;
      const endY = e.clientY ?? this.curY;
      const minX = Math.min(this.startX, endX);
      const minY = Math.min(this.startY, endY);
      const maxX = Math.max(this.startX, endX);
      const maxY = Math.max(this.startY, endY);
      this.cancelDrag();
      if (!wasDragging) return;
      this.suppressClickUntil = Date.now() + 200;
      this.applyBoxSelection(minX, minY, maxX, maxY, Boolean(e.shiftKey));
    };

    const onPointerCancel = () => this.cancelDrag();
    const onClickCapture = (ev: Event) => {
      if (Date.now() <= this.suppressClickUntil) {
        this.suppressClickUntil = -Infinity;
        ev.stopImmediatePropagation?.();
        ev.preventDefault?.();
      }
    };

    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('click', onClickCapture, { capture: true });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp, { capture: true });
      window.addEventListener('pointercancel', onPointerCancel, { capture: true });
      window.addEventListener('blur', onPointerCancel);
      this.cleanups.push(() => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp, { capture: true });
        window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
        window.removeEventListener('blur', onPointerCancel);
      });
    }
    this.cleanups.push(() => {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('click', onClickCapture, { capture: true });
    });
  }

  dispose(): void {
    this.cancelDrag();
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.boxEl.remove();
  }
}
