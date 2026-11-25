import { ENTITY_KIND, ENTITY_STATE, type CompiledDataLike } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { SendCommand } from '../../net/commandBus';
import type { ClientView } from '../../store/replica/viewCodec';
import { extractHqFromView, type HqStatusView } from '../shared/hqView';
import type { TilePickerFn } from '../shared/pointer';
import type { ExtractorTierView } from './extractorTierView';
import {
  extractSelectableEntities,
  isTileNearHq,
  unitFailureFromView,
} from './parts/selectionEntityBuilder';
import { dispatchSmartUnitMove, summarizeSelectedMultiUnits } from './parts/multiUnitOrders';
import {
  bindLandfallCanvasEvents,
  checkTileBlockedByBuilding,
  pickSelectableEntityOnTile,
  resolveShiftUnitToggle,
} from './parts/selectionCanvas';
import {
  enrichHqSelectedView,
  hubUnitsLaneTaskId,
  inspectDepositAt,
  type SelectedDepositView,
} from './selectionHelpers';

export { extractHqFromView, hqJobFromStateCode, type HqPanelJob, type HqStatusView } from '../shared/hqView';
export { extractSelectableEntities, isTileNearHq, unitFailureFromView } from './parts/selectionEntityBuilder';
export { inspectDepositAt, resolveEntityActivityProgress, type SelectedDepositView } from './selectionHelpers';

export interface SelectedEntityView {
  entityId: number;
  owner?: number;
  kind: number;
  kindLabel: string;
  shortCode: string;
  isUnit: boolean;
  isMovable: boolean;
  tier: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  cell?: number;
  cellMax?: number;
  currentJob: string;
  queueCount: number;
  footprintW?: number;
  footprintD?: number;
  state?: number;
  progress?: number;
  terraformJob?: boolean;
  extractorTier?: ExtractorTierView;
}

export interface StoreLike {
  readonly latest?: ClientView | GameView | null;
  readonly latestTiles?: ClientView['tiles'] | null;
  onView?(fn: (v: ClientView) => void): () => void;
  onCommandRejected?(fn: (r: { id: string; kind: string; code: string }) => void): () => void;
  sendCommand?(cmdOrKind: unknown, args?: unknown): unknown;
  /** The host's live balance data (HQ maxima the view does not carry). */
  simData?(): CompiledDataLike | null;
}

export type TilePicker = TilePickerFn;

export interface LandfallControllerOptions {
  store?: StoreLike;
  sendCommand?: SendCommand;
  pickTile?: TilePicker;
  canvas?: HTMLElement | null;
  ownerColonyIndex?: number;
  autoSelect?: boolean;
  spectator?: boolean;
  onColonyInspected?: (colonyIndex: number) => void;
  isHqDeployed?: () => boolean;
  onTargetMove?: (q: number, r: number) => void;
  /** A player order of the HQ failed in the sim (e.g. no path to the target); called once per failure. */
  onOrderFailed?: (failure: UnitFailureView) => void;
}

/** `blobs.units.byId[id].lastFailure` as the view carries it (see `@terra/sim` `UnitFailure`). */
export interface UnitFailureView {
  code: string;
  tick: number;
  kind: string;
  source: string;
}

export type LandfallListener = (snapshot: {
  hq: HqStatusView | null;
  selectedEntityId: number | null;
  selectedEntityIds: readonly number[];
  selectedEntity: SelectedEntityView | null;
  selectedDeposit: SelectedDepositView | null;
}) => void;

/** A second right-click order on the same tile within this window is the same click reported twice. */
export const RIGHT_CLICK_DEDUPE_MS = 400;

export class LandfallController {
  private selectedEntityId: number | null = null;
  private selectedEntityIds: number[] = [];
  public selectedDeposit: SelectedDepositView | null = null;
  private autoSelect: boolean;
  private spectator: boolean;
  private ownerColonyIndex?: number;
  private latestHq: HqStatusView | null = null;
  private latestView: unknown = null;
  private entitiesById = new Map<number, SelectedEntityView>();
  private readonly listeners = new Set<LandfallListener>();
  private readonly cleanups: Array<() => void> = [];
  private pickTile?: TilePicker;
  private seenFailureTick: number | null = null;

  constructor(private readonly opts: LandfallControllerOptions = {}) {
    this.autoSelect = opts.autoSelect !== false;
    this.spectator = Boolean(opts.spectator);
    this.ownerColonyIndex = opts.ownerColonyIndex;
    this.pickTile = opts.pickTile;
    if (opts.store?.latest) {
      this.onView(opts.store.latest);
    }
    if (opts.store?.onView) {
      this.cleanups.push(opts.store.onView((v) => this.onView(v)));
    }
    if (opts.canvas) {
      this.cleanups.push(this.bindCanvas(opts.canvas, opts.pickTile));
    }
  }

  onChange(fn: LandfallListener): () => void {
    this.listeners.add(fn);
    fn(this.buildSnapshot());
    return () => this.listeners.delete(fn);
  }

  private buildSnapshot() {
    return {
      hq: this.latestHq,
      selectedEntityId: this.selectedEntityId,
      selectedEntityIds: this.getSelectedEntityIds(),
      selectedEntity: this.getSelectedEntity(),
      selectedDeposit: this.selectedDeposit,
    };
  }

  private emit(): void {
    const snap = this.buildSnapshot();
    for (const fn of this.listeners) fn(snap);
  }

  getOwnerColonyIndex(): number | undefined { return this.ownerColonyIndex; }
  isSpectator(): boolean { return this.spectator; }
  isDeployed(): boolean { return this.opts.isHqDeployed ? this.opts.isHqDeployed() : true; }

  setSpectator(on: boolean): void {
    if (this.spectator === on) return;
    this.spectator = on;
    if (this.opts.store?.latest) this.onView(this.opts.store.latest);
  }

  setOwnerColonyIndex(colonyIndex: number | undefined): void {
    const changed = this.ownerColonyIndex !== colonyIndex;
    this.ownerColonyIndex = colonyIndex;
    if (this.spectator && changed) {
      const current = this.selectedEntityId !== null ? this.entitiesById.get(this.selectedEntityId) : null;
      const belongsToTarget = Boolean(
        current && typeof colonyIndex === 'number' && current.owner === colonyIndex,
      );
      if (!belongsToTarget || this.selectedDeposit) {
        this.selectedEntityId = null;
        this.selectedDeposit = null;
        this.autoSelect = true;
      }
    }
    if (this.opts.store?.latest) this.onView(this.opts.store.latest);
  }

  private findFallbackEntityId(owner: number | undefined): number | null {
    if (typeof owner !== 'number') return null;
    for (const e of this.entitiesById.values()) {
      if (e.owner === owner) return e.entityId;
    }
    return null;
  }

  onView(view: unknown): void {
    this.latestView = view;
    if (this.opts.isHqDeployed && !this.opts.isHqDeployed()) {
      this.latestHq = null;
      this.entitiesById.clear();
      this.selectedEntityId = null;
      this.selectedEntityIds = [];
      this.selectedDeposit = null;
      this.emit();
      return;
    }
    const hq = extractHqFromView(view, this.ownerColonyIndex, this.opts.store?.simData?.() ?? undefined);
    if (!hq && view && typeof view === 'object' && !('entities' in view) && !('colonies' in view) && !('units' in view) && !('tiles' in view)) {
      return;
    }
    this.latestHq = hq;
    this.entitiesById = extractSelectableEntities(view, this.ownerColonyIndex, hq, this.spectator);

    if (this.selectedDeposit) {
      const updated = inspectDepositAt(
        view,
        this.opts.store?.latestTiles,
        this.selectedDeposit.q,
        this.selectedDeposit.r,
        this.selectedDeposit.deposit,
      );
      if (updated) this.selectedDeposit = updated;
    }

    const fallbackId = hq?.entityId ?? (this.spectator ? this.findFallbackEntityId(this.ownerColonyIndex) : null);
    if (this.spectator && this.selectedEntityId !== null && typeof this.ownerColonyIndex === 'number') {
      const sel = this.entitiesById.get(this.selectedEntityId);
      if (sel && typeof sel.owner === 'number' && sel.owner >= 0 && sel.owner !== this.ownerColonyIndex) {
        this.selectedEntityId = null;
        this.autoSelect = true;
      }
    }
    if (this.selectedEntityIds.length > 0) {
      this.selectedEntityIds = this.selectedEntityIds.filter(
        (id) => this.entitiesById.has(id) || (hq !== null && hq.entityId === id),
      );
      if (this.selectedEntityId !== null && !this.selectedEntityIds.includes(this.selectedEntityId)) {
        this.selectedEntityId = this.selectedEntityIds[this.selectedEntityIds.length - 1] ?? null;
      }
    }
    if (this.selectedEntityId !== null && !this.entitiesById.has(this.selectedEntityId)) {
      this.selectedEntityId = this.autoSelect && !this.selectedDeposit && fallbackId !== null ? fallbackId : null;
      this.selectedEntityIds = this.selectedEntityId !== null ? [this.selectedEntityId] : [];
    } else if (this.selectedEntityId === null && !this.selectedDeposit && this.autoSelect && fallbackId !== null) {
      this.selectedEntityId = fallbackId;
      this.selectedEntityIds = [fallbackId];
    }
    this.reportFailure(view, hq);
    this.emit();
  }

  private reportFailure(view: unknown, hq: HqStatusView | null): void {
    const targetId = this.selectedEntityId ?? hq?.entityId;
    if (targetId === undefined || targetId === null) return;
    const f = unitFailureFromView(view, targetId);
    const tick = f?.tick ?? -1;
    if (this.seenFailureTick === null) { this.seenFailureTick = tick; return; }
    if (!f || tick <= this.seenFailureTick) return;
    this.seenFailureTick = tick;
    if (f.source === 'player') this.opts.onOrderFailed?.(f);
  }

  selectEntity(entityId: number | null): number | null {
    if (entityId === null) {
      this.deselect();
      return null;
    }
    let target = this.entitiesById.get(entityId);
    if (!target && this.opts.store?.latest && this.opts.store.latest !== this.latestView) {
      this.onView(this.opts.store.latest);
      target = this.entitiesById.get(entityId);
    }
    if (
      this.latestHq &&
      entityId === this.latestHq.entityId &&
      (!this.spectator || target?.owner === this.ownerColonyIndex)
    ) {
      return this.selectHq();
    }
    if (!target) return this.selectedEntityId;
    this.autoSelect = false;
    this.selectedDeposit = null;
    this.selectedEntityId = entityId;
    this.selectedEntityIds = [entityId];
    if (
      this.spectator &&
      typeof target.owner === 'number' &&
      target.owner >= 0 &&
      target.owner !== this.ownerColonyIndex
    ) {
      this.ownerColonyIndex = target.owner;
      if (this.opts.store?.latest) {
        this.latestHq = extractHqFromView(this.opts.store.latest, this.ownerColonyIndex, this.opts.store?.simData?.() ?? undefined);
      }
      this.opts.onColonyInspected?.(target.owner);
    }
    this.emit();
    return this.selectedEntityId;
  }

  selectEntities(entityIds: readonly number[]): number[] {
    if (this.opts.store?.latest && this.opts.store.latest !== this.latestView) {
      this.onView(this.opts.store.latest);
    }
    const valid: number[] = [];
    for (const rawId of entityIds) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0 || valid.includes(id)) continue;
      if (this.entitiesById.has(id) || (this.latestHq && this.latestHq.entityId === id)) {
        valid.push(id);
      }
    }
    if (valid.length === 0) {
      this.deselect();
      return [];
    }
    this.autoSelect = false;
    this.selectedDeposit = null;
    this.selectedEntityIds = valid;
    this.selectedEntityId = valid[valid.length - 1] ?? null;
    this.emit();
    return [...this.selectedEntityIds];
  }

  selectHq(): number | null {
    if (this.opts.isHqDeployed && !this.opts.isHqDeployed()) {
      this.selectedEntityId = null;
      this.selectedEntityIds = [];
      this.emit();
      return null;
    }
    this.autoSelect = true;
    this.selectedDeposit = null;
    if (this.latestHq) {
      this.selectedEntityId = this.latestHq.entityId;
      this.selectedEntityIds = [this.latestHq.entityId];
    }
    this.emit();
    return this.selectedEntityId;
  }

  toggleSelectHq(): number | null {
    if (this.selectedEntityId !== null || this.selectedDeposit !== null) {
      this.deselect();
      return null;
    }
    return this.selectHq();
  }

  deselect(): void {
    this.autoSelect = false;
    this.selectedEntityId = null;
    this.selectedEntityIds = [];
    this.selectedDeposit = null;
    this.emit();
  }

  isSelected(): boolean {
    return (this.selectedEntityId !== null && this.getSelectedEntity() !== null) || this.selectedDeposit !== null;
  }

  getSelectedEntityId(): number | null { return this.selectedEntityId; }
  getSelectedEntityIds(): number[] {
    if (this.selectedEntityIds.length > 0) return [...this.selectedEntityIds];
    return this.selectedEntityId !== null ? [this.selectedEntityId] : [];
  }
  getEntityById(id: number): SelectedEntityView | null {
    return this.entitiesById.get(id) ?? (this.latestHq?.entityId === id ? enrichHqSelectedView(this.latestHq, this.latestView ?? this.opts.store?.latest) : null);
  }
  getAllSelectableEntities(): SelectedEntityView[] { return [...this.entitiesById.values()]; }
  getMultiSelectionSummary() { return summarizeSelectedMultiUnits(this.getSelectedEntityIds().map((id) => this.getEntityById(id)).filter((e): e is SelectedEntityView => Boolean(e))); }
  getSelectedDeposit(): SelectedDepositView | null { return this.selectedDeposit; }
  getHq(): HqStatusView | null { return this.latestHq; }

  getSelectedEntity(): SelectedEntityView | null {
    if (this.selectedEntityId === null) return null;
    const found = this.entitiesById.get(this.selectedEntityId);
    if (found) return found;
    if (this.latestHq && this.selectedEntityId === this.latestHq.entityId) {
      return enrichHqSelectedView(this.latestHq, this.latestView ?? this.opts.store?.latest);
    }
    return null;
  }

  isTileBlockedByBuilding(q: number, r: number): boolean {
    return checkTileBlockedByBuilding(this.entitiesById.values(), this.latestView ?? this.opts.store?.latest, this.opts.store?.simData?.() ?? undefined, q, r);
  }

  private sendRawCommand(kind: string, args: Record<string, unknown>): void {
    if (this.opts.store?.sendCommand) this.opts.store.sendCommand({ type: kind, ...args });
    else if (this.opts.sendCommand) void this.opts.sendCommand(kind, args);
  }

  orderMove(q: number, r: number): boolean {
    if (this.spectator || !Number.isInteger(q) || !Number.isInteger(r)) return false;
    const movableIds = this.getSelectedEntityIds().filter((id) => this.getEntityById(id)?.isMovable);
    if (movableIds.length === 0) return false;
    if (!this.opts.store?.sendCommand && !this.opts.sendCommand) return false;
    let resolvedQ = q, resolvedR = r;
    const ok = dispatchSmartUnitMove({
      unitIds: movableIds, q, r,
      view: this.latestView ?? this.opts.store?.latest,
      fallbackTiles: this.opts.store?.latestTiles,
      simData: this.opts.store?.simData?.() ?? null,
      ownerColonyIndex: this.ownerColonyIndex ?? 0,
      isBlockedByBuilding: (tq, tr) => this.isTileBlockedByBuilding(tq, tr),
      onResolvedTarget: (tq, tr) => { resolvedQ = tq; resolvedR = tr; },
      send: (kind, args) => this.sendRawCommand(kind, args),
    });
    if (ok) this.opts.onTargetMove?.(resolvedQ, resolvedR);
    return ok;
  }

  stopSelected(): boolean {
    if (this.spectator || (!this.opts.store?.sendCommand && !this.opts.sendCommand)) return false;
    const movableIds = this.getSelectedEntityIds().filter((id) => this.getEntityById(id)?.isMovable);
    if (movableIds.length === 0) return false;
    for (const entityId of movableIds) this.sendRawCommand('stopUnit', { entityId });
    return true;
  }

  cancelSelected(): boolean {
    if (this.spectator) return false;
    const sel = this.getSelectedEntity();
    if (!sel) return false;
    const isConstructingBuilding = !sel.isUnit && (sel.currentJob === 'constructing' || sel.state === ENTITY_STATE.constructing);
    const taskId = isConstructingBuilding
      ? `building:${sel.entityId}`
      : !sel.isUnit && sel.kind === ENTITY_KIND.commandHub // the Hub's job is its Units lane, never every lane ('all')
        ? hubUnitsLaneTaskId(this.latestView ?? this.opts.store?.latest, this.getOwnerColonyIndex() ?? 0)
        : `worker:${sel.entityId}`;
    if (taskId === null) return false;
    if (this.opts.store?.sendCommand) {
      this.opts.store.sendCommand({ type: 'cancelTask', taskId });
    } else if (this.opts.sendCommand) { // one channel, like orderMove / stopSelected (both are set online)
      void this.opts.sendCommand('cancelTask', { taskId });
    }
    return Boolean(this.opts.store?.sendCommand || this.opts.sendCommand);
  }

  pickEntityAt(q: number, r: number, pickedEntityId?: number): SelectedEntityView | null {
    return pickSelectableEntityOnTile(this.entitiesById.values(), this.selectedEntityId, q, r, pickedEntityId);
  }

  clickTile(q: number, r: number, shiftKey = false, pickedEntityId?: number): boolean {
    return this.handleLeftClick(q, r, shiftKey, pickedEntityId);
  }

  handleLeftClick(q: number, r: number, shiftKey = false, pickedEntityId?: number): boolean {
    const sel = this.getSelectedEntity();
    const hit = this.pickEntityAt(q, r, pickedEntityId);
    if (shiftKey && hit?.isUnit) {
      this.selectEntities(resolveShiftUnitToggle(this.selectedEntityIds, this.entitiesById, hit.entityId));
      return true;
    }
    if (shiftKey && sel?.isMovable && !this.spectator) {
      return this.orderMove(q, r);
    }
    if (hit) {
      this.selectEntity(hit.entityId);
      return true;
    }
    const dep = inspectDepositAt(this.latestView ?? this.opts.store?.latest, this.opts.store?.latestTiles, q, r);
    if (dep && dep.deposit > 0) {
      this.autoSelect = false;
      this.selectedEntityId = null;
      this.selectedEntityIds = [];
      this.selectedDeposit = dep;
      this.emit();
      return true;
    }
    if (this.latestHq && isTileNearHq(this.latestHq, q, r, 0)) {
      this.selectHq();
      return true;
    }
    this.deselect();
    return false;
  }

  handleRightClick(q: number, r: number): boolean {
    if (this.spectator) return false;
    return this.orderMove(q, r);
  }

  bindCanvas(canvas: HTMLElement, pickTile: TilePicker | undefined = this.pickTile): () => void {
    if (pickTile) this.pickTile = pickTile;
    return bindLandfallCanvasEvents(
      canvas,
      () => this.pickTile,
      RIGHT_CLICK_DEDUPE_MS,
      (q, r, shift, entityId) => { this.handleLeftClick(q, r, shift, entityId); },
      (q, r) => { this.handleRightClick(q, r); },
    );
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.listeners.clear();
  }
}
