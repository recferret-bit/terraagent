import { ENTITY_KIND } from '@terra/sim';
import type { SendCommand } from '../../net/commandBus';
import type { EntityRow } from '../../store/replica/viewCodec';
import { isHotkeyPress, isTypingTarget } from '../shared/hotkeys';
import type { TilePickerFn } from '../shared/pointer';
import type { SelectionCombatSummary } from '../landfall/HqPanel';
import { dispatchSmartUnitMove, isUniversalImpassableTile } from '../landfall/parts/multiUnitOrders';
import type { LandfallController, StoreLike } from '../landfall/selection';
import { isArmyCombatUnitKind } from '../landfall/selectionHelpers';
import { ORDER_MARKER_TTL_MS, type OrderMarker, type OrderMarkerKind } from './OrderMarkersRenderer';
import {
  collectEntitiesFromView,
  findHostileOrFaunaTargetOnTile,
  findOwnCombatUnitsOnTile,
  isEntityAlive,
  pruneAndCollectOptimisticTargets,
  resolveSelectedArmedIssuers,
  summarizeSelectedCombatUnits,
} from './parts/armyEntityQueries';
import { bindArmySurfaceEvents } from './parts/armySurfaceBinder';

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
  private readonly optimisticTargets = new Map<number, { targetId: number; atMs: number }>();
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
    return landfall.onChange(({ selectedEntityId, selectedEntityIds, selectedEntity }) => {
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
      if (selectedEntityIds && selectedEntityIds.length > 1) {
        const armyIds = selectedEntityIds.filter((id) => {
          const ent = landfall.getEntityById(id);
          return Boolean(ent && isArmyCombatUnitKind(ent.kind));
        });
        this.lastLandfallId = selectedEntityId;
        if (armyIds.length !== this.selectedEntityIds.length || armyIds.some((id, i) => id !== this.selectedEntityIds[i])) {
          this.selectedEntityIds = armyIds;
          if (armyIds.length === 0) this.attackMoveArmed = false;
          else this.currentStance = this.stanceByUnitId.get(armyIds[0]!) ?? this.currentStance;
          this.emit();
        }
        return;
      }
      if (
        typeof landfall.selectEntities !== 'function' &&
        this.selectedEntityIds.length > 1 &&
        selectedEntityId === this.lastLandfallId &&
        this.selectedEntityIds.includes(selectedEntityId)
      ) {
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

  private syncLandfallSelection(entityId: number | null, preserveNonArmyUnits = false): void {
    this.lastLandfallId = entityId;
    const lf = this.opts.landfall;
    if (!lf) return;
    this.suppressLandfallSync = true;
    try {
      if (entityId !== null && typeof lf.selectEntities === 'function') {
        const keptWorkers = preserveNonArmyUnits
          ? lf.getSelectedEntityIds().filter((id) => {
              const ent = lf.getEntityById(id);
              return Boolean(ent?.isUnit && ent.kind !== ENTITY_KIND.hq && !isArmyCombatUnitKind(ent.kind));
            })
          : [];
        const merged = [...new Set([...keptWorkers, ...this.selectedEntityIds])];
        if (merged.length > 1) {
          lf.selectEntities(merged);
          this.lastLandfallId = merged[merged.length - 1] ?? entityId;
          return;
        }
        lf.selectEntity(merged[0] ?? entityId);
        return;
      }
      lf.selectEntity(entityId);
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

  syncFromMarqueeUnits(armyIds: readonly number[], landfallPrimaryId: number | null): void {
    this.selectedEntityIds = [...armyIds];
    this.lastLandfallId = landfallPrimaryId;
    if (armyIds.length === 0) this.attackMoveArmed = false;
    else this.currentStance = this.stanceByUnitId.get(armyIds[0]!) ?? this.currentStance;
    this.emit();
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
    if (stance === 'hold') this.clearOptimisticTargets(this.selectedEntityIds);
    if (this.selectedEntityIds.length > 0) {
      this.dispatchCommand('setStance', { unitIds: [...this.selectedEntityIds], stance });
    }
    this.emit();
    return this.selectedEntityIds.length > 0;
  }

  private setOptimisticTarget(unitIds: readonly number[], targetId: number): void {
    const atMs = this.now();
    for (const id of unitIds) this.optimisticTargets.set(id, { targetId, atMs });
  }
  private clearOptimisticTargets(unitIds: readonly number[]): void { for (const id of unitIds) this.optimisticTargets.delete(id); }
  getOptimisticTargets(nowMs = this.now()): Map<number, number> {
    return pruneAndCollectOptimisticTargets(this.optimisticTargets, nowMs);
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

  findHostileTargetAt(q: number, r: number, pickedEntityId?: number): EntityRow | null { return findHostileOrFaunaTargetOnTile(this.resolveView(), this.resolveColonyIndex(), q, r, pickedEntityId); }
  private findOwnCombatUnitsAt(q: number, r: number, pickedEntityId?: number): EntityRow[] { return findOwnCombatUnitsOnTile(this.resolveView(), this.resolveColonyIndex(), q, r, pickedEntityId); }
  private findNonOwnTargetAt(q: number, r: number, pickedEntityId?: number): EntityRow | null { return this.findHostileTargetAt(q, r, pickedEntityId); }

  clickTile(q: number, r: number, shiftKey = false, pickedEntityId?: number): boolean {
    if (this.isReadOnly()) return false;
    if (!Number.isFinite(q) || !Number.isFinite(r)) return false;
    if (this.attackMoveArmed && this.selectedEntityIds.length > 0) {
      const hasHostileAtTile = this.findNonOwnTargetAt(q, r, pickedEntityId) !== null;
      if (
        !hasHostileAtTile &&
        isUniversalImpassableTile(this.resolveView(), this.opts.store?.latestTiles, q, r, (tq, tr) => Boolean(this.opts.landfall?.isTileBlockedByBuilding(tq, tr)))
      ) {
        return false;
      }
      const unitIds = [...this.selectedEntityIds];
      this.attackMoveArmed = false;
      this.clearOptimisticTargets(unitIds);
      this.dispatchCommand('attackMove', { unitIds, q, r });
      this.addOrderMarker('attackMove', q, r);
      this.emit();
      return true;
    }

    const hits = this.findOwnCombatUnitsAt(q, r, pickedEntityId);
    const issuers = !shiftKey ? resolveSelectedArmedIssuers(this.selectedEntityIds, this.opts.landfall?.getSelectedEntity()) : [];
    const hostile = issuers.length > 0 ? this.findNonOwnTargetAt(q, r, pickedEntityId) : null;
    const ownDirectPick = typeof pickedEntityId === 'number' && hits.some((h) => h.id === pickedEntityId);
    if (hostile && !ownDirectPick && (hostile.id === pickedEntityId || hits.length === 0)) {
      this.dispatchCommand('attackTarget', { unitIds: issuers, targetId: hostile.id });
      this.setOptimisticTarget(issuers, hostile.id);
      this.addOrderMarker('attackTarget', q, r, hostile.id);
      this.emit();
      return true;
    }

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
      this.syncLandfallSelection(primaryId, shiftKey);
      this.emit();
      return true;
    }

    if (!shiftKey && this.selectedEntityIds.length > 0) {
      this.selectedEntityIds = [];
      this.attackMoveArmed = false;
      this.optimisticTargets.clear();
      this.emit();
    }
    return false;
  }

  rightClickTile(q: number, r: number, pickedEntityId?: number): boolean {
    if (this.isReadOnly()) return false;
    if (!Number.isFinite(q) || !Number.isFinite(r)) return false;
    const landfallSel = this.opts.landfall?.getSelectedEntity();
    if (this.selectedEntityIds.length === 0 && landfallSel && isArmyCombatUnitKind(landfallSel.kind)) {
      this.selectedEntityIds = [landfallSel.entityId];
    }
    const issuers = resolveSelectedArmedIssuers(this.selectedEntityIds, landfallSel);
    if (issuers.length === 0) return false;
    this.attackMoveArmed = false;

    const target = this.findNonOwnTargetAt(q, r, pickedEntityId);
    if (target) {
      this.dispatchCommand('attackTarget', { unitIds: issuers, targetId: target.id });
      this.setOptimisticTarget(issuers, target.id);
      this.addOrderMarker('attackTarget', q, r, target.id);
      this.emit();
      return true;
    }

    const lfMovable = (this.opts.landfall?.getSelectedEntityIds() ?? []).filter((id) => this.opts.landfall?.getEntityById(id)?.isMovable);
    const moveIds = [...new Set([...this.selectedEntityIds, ...lfMovable])];
    if (moveIds.length === 0) return false;
    let markerQ = q;
    let markerR = r;
    const ok = dispatchSmartUnitMove({
      unitIds: moveIds,
      q,
      r,
      view: this.resolveView(),
      fallbackTiles: this.opts.store?.latestTiles,
      simData: this.opts.store?.simData?.() ?? null,
      ownerColonyIndex: this.resolveColonyIndex(),
      isBlockedByBuilding: (tq, tr) => Boolean(this.opts.landfall?.isTileBlockedByBuilding(tq, tr)),
      onResolvedTarget: (tq, tr) => {
        markerQ = tq;
        markerR = tr;
      },
      send: (kind, args) => this.dispatchCommand(kind, args),
    });
    if (!ok) return false;
    this.clearOptimisticTargets(this.selectedEntityIds);
    this.addOrderMarker('move', markerQ, markerR);
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
    return bindArmySurfaceEvents(surface, {
      now: () => this.now(),
      isBlocked: () => Boolean(this.isReadOnly() || this.opts.isInputBlocked?.()),
      getPickTile: () => this.pickTile,
      getSelectedEntityIds: () => this.selectedEntityIds,
      isAttackMoveArmed: () => this.attackMoveArmed,
      getLandfall: () => this.opts.landfall,
      findOwnCombatUnitsAt: (q, r, pid) => this.findOwnCombatUnitsAt(q, r, pid),
      findNonOwnTargetAt: (q, r, pid) => this.findNonOwnTargetAt(q, r, pid),
      clickTile: (q, r, shift, pid) => this.clickTile(q, r, shift, pid),
      rightClickTile: (q, r, pid) => this.rightClickTile(q, r, pid),
      clearSquadSelection: () => {
        this.selectedEntityIds = [];
        this.attackMoveArmed = false;
        this.optimisticTargets.clear();
        this.emit();
      },
    });
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.listeners.clear();
  }
}
