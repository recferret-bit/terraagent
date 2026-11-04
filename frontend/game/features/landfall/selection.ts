import { ENTITY_KIND, ENTITY_STATE, entityFootprint, getBuildingFootprintTiles, hexDistance, occupiesGround, type CompiledDataLike, type ViewEntity } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { SendCommand } from '../../net/commandBus';
import { forEachEntity, type ClientView } from '../../store/replica/viewCodec';
import { viewColony } from '../shared/colony';
import { extractHqFromView, type HqStatusView } from '../shared/hqView';
import { resolvePointerTile, type TilePickerFn } from '../shared/pointer';
import type { ExtractorTierView } from './extractorTierView';
import {
  buildSelectedEntityFromRow,
  buildSupplementalUnitMap,
  enrichHqSelectedView,
  hubUnitsLaneTaskId,
  inspectDepositAt,
  isBuildingCoveringTile,
  normalizeEntityRowWithSupplements,
  type SelectedDepositView,
} from './selectionHelpers';

export { extractHqFromView, hqJobFromStateCode, type HqPanelJob, type HqStatusView } from '../shared/hqView';
export { inspectDepositAt, resolveEntityActivityProgress, type SelectedDepositView } from './selectionHelpers';

export interface SelectedEntityView {
  entityId: number;
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

/** The last failed command of unit `id` in a view, or null. */
export function unitFailureFromView(view: unknown, id: number): UnitFailureView | null {
  const units = (view as { blobs?: { units?: { byId?: Record<string, { lastFailure?: UnitFailureView | null }> } } } | null)?.blobs?.units;
  const f = units?.byId?.[String(id)]?.lastFailure;
  return f && typeof f.tick === 'number' && typeof f.code === 'string' ? f : null;
}

export type LandfallListener = (snapshot: {
  hq: HqStatusView | null;
  selectedEntityId: number | null;
  selectedEntity: SelectedEntityView | null;
  selectedDeposit: SelectedDepositView | null;
}) => void;

export function isTileNearHq(hq: HqStatusView, q: number, r: number, maxDist = 1): boolean {
  return (
    hexDistance(q, r, hq.q, hq.r) <= maxDist ||
    hexDistance(q, r, Math.round(hq.x), Math.round(hq.y)) <= maxDist
  );
}

export function extractSelectableEntities(
  rawView: unknown,
  ownerColonyIndex?: number,
  hq?: HqStatusView | null,
): Map<number, SelectedEntityView> {
  const out = new Map<number, SelectedEntityView>();
  const resolvedHq = hq === undefined ? extractHqFromView(rawView, ownerColonyIndex) : hq;
  if (resolvedHq) out.set(resolvedHq.entityId, enrichHqSelectedView(resolvedHq, rawView));
  if (!rawView || typeof rawView !== 'object') return out;
  const view = rawView as { entities?: Float32Array | ViewEntity[] | Record<string, unknown>; count?: number; blobs?: Record<string, unknown> } & Record<string, unknown>;
  const owner = ownerColonyIndex ?? resolvedHq?.owner ?? 0;
  const col = viewColony(view, owner) as Record<string, unknown> | undefined;
  const powerBlob = (view.blobs?.power as { byColony?: Record<number, { offlineReasons?: Record<number, string> }> } | undefined)?.byColony?.[owner];
  const colPower = col?.power as { offlineReasons?: Record<number, string> } | undefined;
  const offlineReasons = colPower?.offlineReasons ?? powerBlob?.offlineReasons ?? {};
  const unitsById = ((view.blobs?.units as { byId?: Record<string, { current?: unknown; queue?: unknown[] }> } | undefined)?.byId) ?? {};
  const supMap = buildSupplementalUnitMap(view);

  const addRaw = (raw: Record<string, unknown>) => {
    const id = Number(raw.id ?? raw.entityId ?? 0);
    const row = normalizeEntityRowWithSupplements(raw, supMap.get(id));
    if (ownerColonyIndex !== undefined && row.owner !== ownerColonyIndex) return;
    if (row.kind === ENTITY_KIND.hq) {
      if (resolvedHq) out.set(resolvedHq.entityId, enrichHqSelectedView(resolvedHq, rawView));
      return;
    }
    const sel = buildSelectedEntityFromRow(row, rawView, offlineReasons, unitsById);
    if (sel) out.set(sel.entityId, sel);
  };

  if (view.entities instanceof Float32Array || Array.isArray(view.entities)) {
    forEachEntity(view.entities, view.count, (e) => addRaw(e as unknown as Record<string, unknown>));
  } else if (view.entities && typeof view.entities === 'object') {
    for (const [k, v] of Object.entries(view.entities)) {
      if (v && typeof v === 'object') addRaw({ id: Number(k), ...(v as Record<string, unknown>) });
    }
  }
  for (const [id, sup] of supMap.entries()) {
    if (!out.has(id)) addRaw(sup);
  }
  return out;
}

/** A second right-click order on the same tile within this window is the same click reported twice. */
export const RIGHT_CLICK_DEDUPE_MS = 400;

export class LandfallController {
  private selectedEntityId: number | null = null;
  public selectedDeposit: SelectedDepositView | null = null;
  private autoSelect: boolean;
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
    fn({
      hq: this.latestHq,
      selectedEntityId: this.selectedEntityId,
      selectedEntity: this.getSelectedEntity(),
      selectedDeposit: this.selectedDeposit,
    });
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = {
      hq: this.latestHq,
      selectedEntityId: this.selectedEntityId,
      selectedEntity: this.getSelectedEntity(),
      selectedDeposit: this.selectedDeposit,
    };
    for (const fn of this.listeners) fn(snap);
  }

  getOwnerColonyIndex(): number | undefined {
    return this.ownerColonyIndex;
  }

  setOwnerColonyIndex(colonyIndex: number | undefined): void {
    this.ownerColonyIndex = colonyIndex;
    if (this.opts.store?.latest) {
      this.onView(this.opts.store.latest);
    }
  }

  onView(view: unknown): void {
    this.latestView = view;
    if (this.opts.isHqDeployed && !this.opts.isHqDeployed()) {
      this.latestHq = null;
      this.entitiesById.clear();
      this.selectedEntityId = null;
      this.selectedDeposit = null;
      this.emit();
      return;
    }
    const hq = extractHqFromView(view, this.ownerColonyIndex, this.opts.store?.simData?.() ?? undefined);
    if (!hq && view && typeof view === 'object' && !('entities' in view) && !('colonies' in view) && !('units' in view) && !('tiles' in view)) {
      return;
    }
    this.latestHq = hq;
    this.entitiesById = extractSelectableEntities(view, this.ownerColonyIndex, hq);

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

    if (this.selectedEntityId !== null && !this.entitiesById.has(this.selectedEntityId)) {
      this.selectedEntityId = this.autoSelect && !this.selectedDeposit && hq ? hq.entityId : null;
    } else if (this.selectedEntityId === null && !this.selectedDeposit && this.autoSelect && hq) {
      this.selectedEntityId = hq.entityId;
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
    if (this.latestHq && entityId === this.latestHq.entityId) {
      return this.selectHq();
    }
    if (!this.entitiesById.has(entityId)) return this.selectedEntityId;
    this.autoSelect = false;
    this.selectedDeposit = null;
    this.selectedEntityId = entityId;
    this.emit();
    return this.selectedEntityId;
  }

  selectHq(): number | null {
    if (this.opts.isHqDeployed && !this.opts.isHqDeployed()) {
      this.selectedEntityId = null;
      this.emit();
      return null;
    }
    this.autoSelect = true;
    this.selectedDeposit = null;
    if (this.latestHq) {
      this.selectedEntityId = this.latestHq.entityId;
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
    this.selectedDeposit = null;
    this.emit();
  }

  isSelected(): boolean {
    return (this.selectedEntityId !== null && this.getSelectedEntity() !== null) || this.selectedDeposit !== null;
  }

  getSelectedEntityId(): number | null {
    return this.selectedEntityId;
  }

  getSelectedEntity(): SelectedEntityView | null {
    if (this.selectedEntityId === null) return null;
    const found = this.entitiesById.get(this.selectedEntityId);
    if (found) return found;
    if (this.latestHq && this.selectedEntityId === this.latestHq.entityId) {
      return enrichHqSelectedView(this.latestHq, this.latestView ?? this.opts.store?.latest);
    }
    return null;
  }

  getSelectedDeposit(): SelectedDepositView | null {
    return this.selectedDeposit;
  }

  getHq(): HqStatusView | null {
    return this.latestHq;
  }

  isTileBlockedByBuilding(q: number, r: number): boolean {
    for (const e of this.entitiesById.values()) {
      if (!e.isUnit && isBuildingCoveringTile(e, q, r)) return true;
    }
    const latest = (this.latestView ?? this.opts.store?.latest) as { entities?: Float32Array | ViewEntity[]; count?: number } | null | undefined;
    if (!latest?.entities || (!(latest.entities instanceof Float32Array) && !Array.isArray(latest.entities))) return false;
    let hit = false;
    forEachEntity(latest.entities, latest.count, (e) => {
      // the sim's ground rule (GP-23): alive buildings only (no drop pod), their row footprint
      if (hit || !occupiesGround(e)) return;
      hit = getBuildingFootprintTiles(e.q, e.r, entityFootprint(e.kind, this.opts.store?.simData?.() ?? undefined)).some((p) => p.q === q && p.r === r);
    });
    return hit;
  }

  orderMove(q: number, r: number): boolean {
    if (!Number.isInteger(q) || !Number.isInteger(r)) return false;
    const sel = this.getSelectedEntity();
    if (!sel || !sel.isMovable) return false;
    if (this.isTileBlockedByBuilding(q, r)) return false;
    const payload = { type: 'moveUnit' as const, entityId: sel.entityId, q, r };
    if (this.opts.store?.sendCommand) {
      this.opts.store.sendCommand(payload);
    } else if (this.opts.sendCommand) {
      void this.opts.sendCommand('moveUnit', { entityId: sel.entityId, q, r });
    }
    this.opts.onTargetMove?.(q, r);
    return true;
  }

  stopSelected(): boolean {
    const sel = this.getSelectedEntity();
    if (!sel || !sel.isMovable) return false;
    if (this.opts.store?.sendCommand) this.opts.store.sendCommand({ type: 'stopUnit', entityId: sel.entityId });
    else if (this.opts.sendCommand) void this.opts.sendCommand('stopUnit', { entityId: sel.entityId });
    else return false;
    return true;
  }

  cancelSelected(): boolean {
    const sel = this.getSelectedEntity();
    if (!sel) return false;
    const isConstructingBuilding = !sel.isUnit && (sel.currentJob === 'constructing' || sel.state === ENTITY_STATE.constructing);
    const taskId = isConstructingBuilding
      ? `building:${sel.entityId}`
      : !sel.isUnit && sel.kind === ENTITY_KIND.commandHub // the Hub's job is its Units lane, never every lane ('all')
        ? hubUnitsLaneTaskId(this.latestView ?? this.opts.store?.latest, this.getOwnerColonyIndex() ?? 0)
        : `harvester:${sel.entityId}`;
    if (taskId === null) return false;
    if (this.opts.store?.sendCommand) {
      this.opts.store.sendCommand({ type: 'cancelTask', taskId });
    } else if (this.opts.sendCommand) { // one channel, like orderMove / stopSelected (both are set online)
      void this.opts.sendCommand('cancelTask', { taskId });
    }
    return Boolean(this.opts.store?.sendCommand || this.opts.sendCommand);
  }

  pickEntityAt(q: number, r: number): SelectedEntityView | null {
    let bestUnit: SelectedEntityView | null = null;
    let bestDist = Infinity;
    for (const e of this.entitiesById.values()) {
      if (!e.isUnit) continue;
      const rx = Math.round(e.x);
      const ry = Math.round(e.y);
      const euclid = Math.hypot(e.x - q, e.y - r);
      const onRounded = (rx === q && ry === r) || (e.q === q && e.r === r);
      if (!onRounded && euclid > 0.75) continue;
      const d = onRounded ? Math.min(euclid, 0.25) : euclid;
      const preferOverCurrent = Math.abs(d - bestDist) < 1e-4 && bestUnit?.entityId === this.selectedEntityId && e.entityId !== this.selectedEntityId;
      if (d < bestDist || preferOverCurrent) {
        bestDist = d;
        bestUnit = e;
      }
    }
    if (bestUnit) return bestUnit;

    for (const e of this.entitiesById.values()) {
      if (e.isUnit) continue;
      if (isBuildingCoveringTile(e, q, r)) return e;
    }
    return null;
  }

  clickTile(q: number, r: number, shiftKey = false): boolean {
    return this.handleLeftClick(q, r, shiftKey);
  }

  handleLeftClick(q: number, r: number, shiftKey = false): boolean {
    const sel = this.getSelectedEntity();
    if (shiftKey && sel?.isMovable) {
      return this.orderMove(q, r);
    }
    const hit = this.pickEntityAt(q, r);
    if (hit) {
      this.selectEntity(hit.entityId);
      return true;
    }
    const dep = inspectDepositAt(this.latestView ?? this.opts.store?.latest, this.opts.store?.latestTiles, q, r);
    if (dep && dep.deposit > 0) {
      this.autoSelect = false;
      this.selectedEntityId = null;
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
    return this.orderMove(q, r);
  }

  bindCanvas(canvas: HTMLElement, pickTile: TilePicker | undefined = this.pickTile): () => void {
    if (pickTile) this.pickTile = pickTile;
    let down = { x: 0, y: 0, button: -1 };
    let lastRight = { at: -1000, q: NaN, r: NaN };
    const orderRight = (q: number, r: number) => {
      const now = Date.now();
      if (now - lastRight.at < RIGHT_CLICK_DEDUPE_MS && lastRight.q === q && lastRight.r === r) return;
      lastRight = { at: now, q, r };
      this.handleRightClick(q, r);
    };

    const resolveTile = (e: MouseEvent) => resolvePointerTile(e, this.pickTile);

    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX ?? 0, y: e.clientY ?? 0, button: e.button ?? 0 };
    };

    const onUp = (e: PointerEvent) => {
      const moved = Math.hypot((e.clientX ?? 0) - down.x, (e.clientY ?? 0) - down.y);
      if (moved > 5) return;
      const pick = resolveTile(e);
      if (!pick) return;
      if (e.button === 0) {
        this.handleLeftClick(pick.q, pick.r, Boolean(e.shiftKey));
      } else if (e.button === 2) {
        orderRight(pick.q, pick.r);
      }
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault?.();
      const pick = resolveTile(e);
      if (pick) orderRight(pick.q, pick.r);
    };

    canvas.addEventListener('pointerdown', onDown as EventListener);
    canvas.addEventListener('pointerup', onUp as EventListener);
    canvas.addEventListener('contextmenu', onContext as EventListener);

    return () => {
      canvas.removeEventListener('pointerdown', onDown as EventListener);
      canvas.removeEventListener('pointerup', onUp as EventListener);
      canvas.removeEventListener('contextmenu', onContext as EventListener);
    };
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.listeners.clear();
  }
}
