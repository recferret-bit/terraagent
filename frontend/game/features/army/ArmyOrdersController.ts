import { ENTITY_KIND } from '@terra/sim';
import type { SendCommand } from '../../net/commandBus';
import type { EntityRow } from '../../store/replica/viewCodec';
import { isHotkeyPress, isTypingTarget } from '../shared/hotkeys';
import { resolvePointerTile, type TilePickerFn } from '../shared/pointer';
import type { SelectionCombatSummary } from '../landfall/HqPanel';
import type { LandfallController, StoreLike } from '../landfall/selection';
import { isArmyCombatUnitKind } from '../landfall/selectionHelpers';
import { ORDER_MARKER_TTL_MS, type OrderMarker, type OrderMarkerKind } from './OrderMarkersRenderer';
import {
  collectEntitiesFromView,
  findHostileOrFaunaTargetOnTile,
  findOwnCombatUnitsOnTile,
  isEntityAlive,
  summarizeSelectedCombatUnits,
} from './parts/armyEntityQueries';

export type ArmyStance = 'hold' | 'defend' | 'hunt';

export interface ArmyOrdersSnapshot {
  selectedEntityIds: readonly number[];
  currentStance: ArmyStance;
  attackMoveArmed: boolean;
  orderMarkers: readonly OrderMarker[];
}

export type ArmyOrdersListener = (snapshot: ArmyOrdersSnapshot) => void;

export interface ArmyOrdersControllerOptions {
  store?: StoreLike;
  sendCommand?: SendCommand | ((kind: string, args?: unknown) => unknown);
  pickTile?: TilePickerFn;
  surface?: HTMLElement | null;
  canvas?: HTMLElement | null;
  landfall?: LandfallController;
  getColonyId?: () => number;
  ownerColonyIndex?: number;
  getView?: () => unknown;
  isInputBlocked?: () => boolean;
  readOnly?: () => boolean;
  now?: () => number;
}

function hasAuthoritativeEntityList(view: unknown): boolean {
  if (!view || typeof view !== 'object') return false;
  const v = view as Record<string, unknown>;
  return v.entities !== undefined || v.units !== undefined || v.colonies !== undefined;
}

export class ArmyOrdersController {
  private selectedEntityIds: number[] = [];
  private currentStance: ArmyStance = 'defend';
  private attackMoveArmed = false;
  private orderMarkers: OrderMarker[] = [];
  private nextMarkerId = 0;
  private latestView: unknown = null;
  private readonly stanceByUnitId = new Map<number, ArmyStance>();
  private readonly listeners = new Set<ArmyOrdersListener>();
  private readonly cleanups: Array<() => void> = [];
  private suppressLandfallSync = false;
  private lastLandfallId: number | null = null;
  private pickTile?: TilePickerFn;
  private readonly now: () => number;

  constructor(private readonly opts: ArmyOrdersControllerOptions = {}) {
    this.pickTile = opts.pickTile;
    this.now = opts.now ?? (() => Date.now());
    if (opts.store?.latest) this.latestView = opts.store.latest;
    if (opts.store?.onView) this.cleanups.push(opts.store.onView((v) => this.onView(v)));
    if (opts.landfall) this.cleanups.push(this.bindLandfall(opts.landfall));
    const surface = opts.surface ?? opts.canvas;
    if (surface) this.cleanups.push(this.bindSurface(surface, opts.pickTile));
    this.cleanups.push(this.bindHotkeys());
  }

  private recoverSurvivingSquadFromDeadPrimary(): boolean {
    if (this.selectedEntityIds.length <= 1 || this.lastLandfallId === null) return false;
    const view = this.opts.store?.latest ?? this.opts.getView?.() ?? this.latestView;
    if (!hasAuthoritativeEntityList(view)) return false;
    const rows = collectEntitiesFromView(view, this.resolveColonyIndex());
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const primaryRow = rowById.get(this.lastLandfallId);
    if (primaryRow && isEntityAlive(primaryRow)) return false;

    const aliveIds = this.selectedEntityIds.filter((id) => {
      const r = rowById.get(id);
      return Boolean(r && isEntityAlive(r));
    });
    if (aliveIds.length === 0) return false;
    this.latestView = view;
    this.selectedEntityIds = aliveIds;
    this.syncLandfallSelection(aliveIds[aliveIds.length - 1]!);
    this.emit();
    return true;
  }

  private bindLandfall(landfall: LandfallController): () => void {
    return landfall.onChange(({ selectedEntityId, selectedEntity }) => {
      if (this.suppressLandfallSync) return;
      if (selectedEntityId === null) {
        if (this.recoverSurvivingSquadFromDeadPrimary()) return;
        this.lastLandfallId = null;
        if (this.selectedEntityIds.length > 0 || this.attackMoveArmed) {
          this.selectedEntityIds = [];
          this.attackMoveArmed = false;
          this.emit();
        }
        return;
      }
      this.lastLandfallId = selectedEntityId;
      if (selectedEntity && isArmyCombatUnitKind(selectedEntity.kind)) {
        if (this.selectedEntityIds.length !== 1 || this.selectedEntityIds[0] !== selectedEntityId) {
          this.selectedEntityIds = [selectedEntityId];
          this.currentStance = this.stanceByUnitId.get(selectedEntityId) ?? this.currentStance;
          this.emit();
        }
      } else if (this.selectedEntityIds.length > 0) {
        this.selectedEntityIds = [];
        this.attackMoveArmed = false;
        this.emit();
      }
    });
  }

  private resolveColonyIndex(): number {
    return this.opts.getColonyId?.() ?? this.opts.landfall?.getOwnerColonyIndex() ?? this.opts.ownerColonyIndex ?? 0;
  }

  private resolveView(): unknown {
    return this.latestView ?? this.opts.store?.latest ?? this.opts.getView?.() ?? null;
  }

  private dispatchCommand(kind: string, args: unknown): void {
    if (this.opts.sendCommand) void this.opts.sendCommand(kind, args);
    else if (this.opts.store?.sendCommand) this.opts.store.sendCommand(kind, args);
  }

  private syncLandfallSelection(entityId: number | null): void {
    this.lastLandfallId = entityId;
    if (!this.opts.landfall) return;
    this.suppressLandfallSync = true;
    try {
      this.opts.landfall.selectEntity(entityId);
    } finally {
      this.suppressLandfallSync = false;
    }
  }

  private addOrderMarker(kind: OrderMarkerKind, q: number, r: number, targetId?: number): OrderMarker {
    this.pruneExpiredMarkers();
    const marker: OrderMarker = {
      id: ++this.nextMarkerId,
      kind,
      q,
      r,
      ...(targetId !== undefined ? { targetId } : {}),
      createdAtMs: this.now(),
      ttlMs: ORDER_MARKER_TTL_MS,
    };
    this.orderMarkers.push(marker);
    return marker;
  }

  pruneExpiredMarkers(nowMs = this.now()): void {
    const before = this.orderMarkers.length;
    if (before === 0) return;
    this.orderMarkers = this.orderMarkers.filter((m) => nowMs - m.createdAtMs < m.ttlMs);
    if (this.orderMarkers.length !== before) this.emit();
  }

  onChange(fn: ArmyOrdersListener): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => this.listeners.delete(fn);
  }

  getSnapshot(): ArmyOrdersSnapshot {
    return {
      selectedEntityIds: [...this.selectedEntityIds],
      currentStance: this.currentStance,
      attackMoveArmed: this.attackMoveArmed,
      orderMarkers: [...this.orderMarkers],
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) fn(snap);
  }

  onView(view: unknown): void {
    this.latestView = view;
    if (!hasAuthoritativeEntityList(view)) return;
    const rows = collectEntitiesFromView(view, this.resolveColonyIndex());
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const aliveIds = this.selectedEntityIds.filter((id) => {
      const r = rowById.get(id);
      return Boolean(r && isEntityAlive(r));
    });
    if (aliveIds.length !== this.selectedEntityIds.length) {
      this.selectedEntityIds = aliveIds;
      if (this.selectedEntityIds.length === 0) this.attackMoveArmed = false;
      this.syncLandfallSelection(aliveIds[aliveIds.length - 1] ?? null);
      this.emit();
    } else if (this.selectedEntityIds.length > 1) {
      this.emit();
    }
  }

  selectUnits(ids: readonly number[]): number[] {
    const unique: number[] = [];
    for (const rawId of ids) {
      const id = Number(rawId);
      if (Number.isInteger(id) && id > 0 && !unique.includes(id)) unique.push(id);
    }
    this.selectedEntityIds = unique;
    if (unique.length === 0) this.attackMoveArmed = false;
    else this.currentStance = this.stanceByUnitId.get(unique[0]!) ?? this.currentStance;
    this.syncLandfallSelection(unique[unique.length - 1] ?? null);
    this.emit();
    return [...this.selectedEntityIds];
  }

  getSelectedEntityIds(): number[] {
    return [...this.selectedEntityIds];
  }

  getCurrentStance(): ArmyStance {
    return this.currentStance;
  }

  isReadOnly(): boolean {
    return Boolean(this.opts.readOnly?.());
  }

  setStance(stance: ArmyStance): boolean {
    if (this.isReadOnly()) return false;
    if (stance !== 'hold' && stance !== 'defend' && stance !== 'hunt') return false;
    this.currentStance = stance;
    for (const id of this.selectedEntityIds) this.stanceByUnitId.set(id, stance);
    if (this.selectedEntityIds.length > 0) {
      this.dispatchCommand('setStance', { unitIds: [...this.selectedEntityIds], stance });
    }
    this.emit();
    return this.selectedEntityIds.length > 0;
  }

  setAttackMoveArmed(armed: boolean): boolean {
    if (armed && this.isReadOnly()) return false;
    const next = Boolean(armed);
    if (this.attackMoveArmed !== next) {
      this.attackMoveArmed = next;
      this.emit();
    }
    return this.attackMoveArmed;
  }

  isAttackMoveArmed(): boolean {
    return this.attackMoveArmed;
  }

  getOrderMarkers(): OrderMarker[] {
    this.pruneExpiredMarkers();
    return [...this.orderMarkers];
  }

  getSelectionSummary(): SelectionCombatSummary | null {
    return summarizeSelectedCombatUnits(this.resolveView(), this.resolveColonyIndex(), this.selectedEntityIds);
  }

  findHostileTargetAt(q: number, r: number): EntityRow | null {
    return findHostileOrFaunaTargetOnTile(this.resolveView(), this.resolveColonyIndex(), q, r);
  }

  private findOwnCombatUnitsAt(q: number, r: number): EntityRow[] {
    return findOwnCombatUnitsOnTile(this.resolveView(), this.resolveColonyIndex(), q, r);
  }

  private findNonOwnTargetAt(q: number, r: number): EntityRow | null {
    return this.findHostileTargetAt(q, r);
  }

  clickTile(q: number, r: number, shiftKey = false): boolean {
    if (this.isReadOnly()) return false;
    if (!Number.isFinite(q) || !Number.isFinite(r)) return false;
    if (this.attackMoveArmed && this.selectedEntityIds.length > 0) {
      const unitIds = [...this.selectedEntityIds];
      this.attackMoveArmed = false;
      this.dispatchCommand('attackMove', { unitIds, q, r });
      this.addOrderMarker('attackMove', q, r);
      this.emit();
      return true;
    }

    const hits = this.findOwnCombatUnitsAt(q, r);
    const armyHits = hits.filter((h) => isArmyCombatUnitKind(h.kind));
    const effectiveHits = armyHits.length > 0 ? armyHits : (shiftKey && this.selectedEntityIds.length > 0 ? [] : hits);
    if (effectiveHits.length > 0) {
      if (shiftKey) {
        const unselected = effectiveHits.find((h) => !this.selectedEntityIds.includes(h.id));
        if (unselected) {
          if (isArmyCombatUnitKind(unselected.kind)) {
            const rows = collectEntitiesFromView(this.resolveView(), this.resolveColonyIndex());
            const byId = new Map(rows.map((row) => [row.id, row]));
            this.selectedEntityIds = this.selectedEntityIds.filter((id) => byId.get(id)?.kind !== ENTITY_KIND.hq);
          }
          this.selectedEntityIds.push(unselected.id);
        } else {
          const toggleId = effectiveHits[0]!.id;
          this.selectedEntityIds = this.selectedEntityIds.filter((id) => id !== toggleId);
        }
      } else {
        this.selectedEntityIds = [effectiveHits[0]!.id];
      }
      const primaryId = this.selectedEntityIds[this.selectedEntityIds.length - 1] ?? null;
      if (primaryId !== null) this.currentStance = this.stanceByUnitId.get(primaryId) ?? this.currentStance;
      this.syncLandfallSelection(primaryId);
      this.emit();
      return true;
    }

    if (!shiftKey && this.selectedEntityIds.length > 0) {
      this.selectedEntityIds = [];
      this.attackMoveArmed = false;
      this.emit();
    }
    return false;
  }

  rightClickTile(q: number, r: number): boolean {
    if (this.isReadOnly()) return false;
    if (!Number.isFinite(q) || !Number.isFinite(r)) return false;
    if (this.selectedEntityIds.length === 0) {
      const landfallSel = this.opts.landfall?.getSelectedEntity();
      if (landfallSel && isArmyCombatUnitKind(landfallSel.kind)) {
        this.selectedEntityIds = [landfallSel.entityId];
      } else if (landfallSel && landfallSel.kind === ENTITY_KIND.hq) {
        const target = this.findNonOwnTargetAt(q, r);
        if (target) {
          this.dispatchCommand('attackTarget', { unitIds: [landfallSel.entityId], targetId: target.id });
          this.addOrderMarker('attackTarget', q, r, target.id);
          this.emit();
          return true;
        }
        return false;
      }
    }
    if (this.selectedEntityIds.length === 0) return false;
    this.attackMoveArmed = false;

    const target = this.findNonOwnTargetAt(q, r);
    if (target) {
      this.dispatchCommand('attackTarget', { unitIds: [...this.selectedEntityIds], targetId: target.id });
      this.addOrderMarker('attackTarget', q, r, target.id);
      this.emit();
      return true;
    }

    for (const entityId of this.selectedEntityIds) {
      this.dispatchCommand('moveUnit', { entityId, q, r });
    }
    this.addOrderMarker('move', q, r);
    this.emit();
    return true;
  }

  private bindHotkeys(): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.opts.isInputBlocked?.() || isTypingTarget(e)) return;
      const key = (e.key ?? '').toLowerCase();
      if ((key === 'a' || e.code === 'KeyA') && isHotkeyPress(e) && this.selectedEntityIds.length > 0) {
        e.preventDefault?.();
        this.setAttackMoveArmed(true);
      } else if (e.key === 'Escape' && this.attackMoveArmed) {
        e.preventDefault?.();
        this.setAttackMoveArmed(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }

  bindSurface(surface: HTMLElement, pickTile: TilePickerFn | undefined = this.pickTile): () => void {
    if (pickTile) this.pickTile = pickTile;
    let down = { x: 0, y: 0, button: -1 };
    let suppressClick: { at: number; q: number; r: number } | null = null;
    let suppressContext: { at: number; q: number; r: number } | null = null;
    const isBlocked = () => Boolean(this.isReadOnly() || this.opts.isInputBlocked?.());

    const onDown = (ev: Event) => {
      const e = ev as PointerEvent;
      down = { x: e.clientX ?? 0, y: e.clientY ?? 0, button: e.button ?? 0 };
    };

    const handleLeft = (e: MouseEvent, fromPointerUp: boolean) => {
      if (isBlocked()) return;
      const pick = resolvePointerTile(e, this.pickTile);
      if (!pick) return;
      if (!fromPointerUp && suppressClick && this.now() - suppressClick.at < 150 && suppressClick.q === pick.q && suppressClick.r === pick.r) {
        suppressClick = null;
        return;
      }
      if (fromPointerUp) suppressClick = { at: this.now(), q: pick.q, r: pick.r };
      const shift = Boolean(e.shiftKey);
      const shouldConsume =
        (this.attackMoveArmed && this.selectedEntityIds.length > 0) ||
        this.findOwnCombatUnitsAt(pick.q, pick.r).some((u) => isArmyCombatUnitKind(u.kind));
      if (shouldConsume) {
        e.stopImmediatePropagation?.();
        this.clickTile(pick.q, pick.r, shift);
      } else if (shift && this.selectedEntityIds.length > 0 && !this.opts.landfall?.pickEntityAt(pick.q, pick.r)) {
        e.stopImmediatePropagation?.();
      } else if (!shift && this.selectedEntityIds.length > 0) {
        this.selectedEntityIds = [];
        this.attackMoveArmed = false;
        this.emit();
      }
    };

    const handleRight = (e: MouseEvent, fromPointerUp: boolean) => {
      if (isBlocked()) return;
      const pick = resolvePointerTile(e, this.pickTile);
      if (!pick) return;
      const landfallSel = this.opts.landfall?.getSelectedEntity();
      const canHandleHqAttack =
        this.selectedEntityIds.length === 0 &&
        landfallSel?.kind === ENTITY_KIND.hq &&
        this.findNonOwnTargetAt(pick.q, pick.r) !== null;
      if (this.selectedEntityIds.length === 0 && !(landfallSel && isArmyCombatUnitKind(landfallSel.kind)) && !canHandleHqAttack) {
        return;
      }
      e.preventDefault?.();
      e.stopImmediatePropagation?.();
      if (!fromPointerUp && suppressContext && this.now() - suppressContext.at < 400 && suppressContext.q === pick.q && suppressContext.r === pick.r) {
        suppressContext = null;
        return;
      }
      if (fromPointerUp) suppressContext = { at: this.now(), q: pick.q, r: pick.r };
      this.rightClickTile(pick.q, pick.r);
    };

    const onUp = (ev: Event) => {
      const e = ev as PointerEvent;
      if (Math.hypot((e.clientX ?? 0) - down.x, (e.clientY ?? 0) - down.y) > 5) return;
      if (e.button === 0) handleLeft(e, true);
      else if (e.button === 2) handleRight(e, true);
    };
    const onClick = (ev: Event) => handleLeft(ev as MouseEvent, false);
    const onContext = (ev: Event) => handleRight(ev as MouseEvent, false);

    const opts = { capture: true };
    surface.addEventListener('pointerdown', onDown, opts);
    surface.addEventListener('pointerup', onUp, opts);
    surface.addEventListener('click', onClick, opts);
    surface.addEventListener('contextmenu', onContext, opts);
    return () => {
      surface.removeEventListener('pointerdown', onDown, opts);
      surface.removeEventListener('pointerup', onUp, opts);
      surface.removeEventListener('click', onClick, opts);
      surface.removeEventListener('contextmenu', onContext, opts);
    };
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.listeners.clear();
  }
}
