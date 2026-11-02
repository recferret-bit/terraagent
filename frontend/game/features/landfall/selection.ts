import { hexDistance, type CompiledDataLike } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { SendCommand } from '../../net/commandBus';
import type { ClientView } from '../../store/replica/viewCodec';
import { extractHqFromView, type HqStatusView } from '../shared/hqView';
import { resolvePointerTile, type TilePickerFn } from '../shared/pointer';

export { extractHqFromView, hqJobFromStateCode, type HqPanelJob, type HqStatusView } from '../shared/hqView';

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

export type LandfallListener = (snapshot: { hq: HqStatusView | null; selectedEntityId: number | null }) => void;

export function isTileNearHq(hq: HqStatusView, q: number, r: number, maxDist = 1): boolean {
  return (
    hexDistance(q, r, hq.q, hq.r) <= maxDist ||
    hexDistance(q, r, Math.round(hq.x), Math.round(hq.y)) <= maxDist
  );
}

/**
 * Manages HQ selection state and right-click / programmatic `moveUnit` orders.
 */
/** A second right-click order on the same tile within this window is the same click reported twice. */
export const RIGHT_CLICK_DEDUPE_MS = 400;

export class LandfallController {
  private selectedEntityId: number | null = null;
  private autoSelect: boolean;
  private ownerColonyIndex?: number;
  private latestHq: HqStatusView | null = null;
  private readonly listeners = new Set<LandfallListener>();
  private readonly cleanups: Array<() => void> = [];
  private pickTile?: TilePicker;
  /** Tick of the newest failure already reported (failures at or before it are old news, e.g. after a reload). */
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
    fn({ hq: this.latestHq, selectedEntityId: this.selectedEntityId });
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = { hq: this.latestHq, selectedEntityId: this.selectedEntityId };
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
    if (this.opts.isHqDeployed && !this.opts.isHqDeployed()) {
      this.latestHq = null;
      this.selectedEntityId = null;
      this.emit();
      return;
    }
    const hq = extractHqFromView(view, this.ownerColonyIndex, this.opts.store?.simData?.() ?? undefined);
    if (!hq && view && typeof view === 'object' && !('entities' in view) && !('colonies' in view)) {
      return;
    }
    this.latestHq = hq;
    if (hq && this.selectedEntityId === null && this.autoSelect) {
      this.selectedEntityId = hq.entityId;
    } else if (hq && this.selectedEntityId !== null && this.selectedEntityId !== hq.entityId && this.autoSelect) {
      this.selectedEntityId = hq.entityId;
    } else if (!hq && this.selectedEntityId !== null) {
      this.selectedEntityId = null;
    }
    this.reportFailure(view, hq);
    this.emit();
  }

  /** The predicted and the confirmed view both carry the same failure (same tick): it is reported once. */
  private reportFailure(view: unknown, hq: HqStatusView | null): void {
    if (!hq) return;
    const f = unitFailureFromView(view, hq.entityId);
    const tick = f?.tick ?? -1;
    if (this.seenFailureTick === null) { this.seenFailureTick = tick; return; }
    if (!f || tick <= this.seenFailureTick) return;
    this.seenFailureTick = tick;
    if (f.source === 'player') this.opts.onOrderFailed?.(f);
  }

  selectHq(): number | null {
    if (this.opts.isHqDeployed && !this.opts.isHqDeployed()) {
      this.selectedEntityId = null;
      this.emit();
      return null;
    }
    this.autoSelect = true;
    if (this.latestHq) {
      this.selectedEntityId = this.latestHq.entityId;
    }
    this.emit();
    return this.selectedEntityId;
  }

  toggleSelectHq(): number | null {
    if (this.selectedEntityId !== null) {
      this.deselect();
      return null;
    }
    return this.selectHq();
  }

  deselect(): void {
    this.autoSelect = false;
    this.selectedEntityId = null;
    this.emit();
  }

  isSelected(): boolean {
    return this.selectedEntityId !== null && this.latestHq !== null && this.selectedEntityId === this.latestHq.entityId;
  }

  getSelectedEntityId(): number | null {
    return this.selectedEntityId;
  }

  getHq(): HqStatusView | null {
    return this.latestHq;
  }

  orderMove(q: number, r: number): boolean {
    if (!Number.isInteger(q) || !Number.isInteger(r)) return false;
    const hq = this.latestHq;
    if (!hq || this.selectedEntityId !== hq.entityId) return false;
    const payload = { type: 'moveUnit' as const, entityId: hq.entityId, q, r };
    if (this.opts.store?.sendCommand) {
      this.opts.store.sendCommand(payload);
    } else if (this.opts.sendCommand) {
      void this.opts.sendCommand('moveUnit', { entityId: hq.entityId, q, r });
    }
    this.opts.onTargetMove?.(q, r);
    return true;
  }

  /** `stopUnit` for the selected HQ (it halts where it is; queued work resumes after a short hold). */
  stopSelected(): boolean {
    const hq = this.latestHq;
    if (!hq || this.selectedEntityId !== hq.entityId) return false;
    if (this.opts.store?.sendCommand) this.opts.store.sendCommand({ type: 'stopUnit', entityId: hq.entityId });
    else if (this.opts.sendCommand) void this.opts.sendCommand('stopUnit', { entityId: hq.entityId });
    else return false;
    return true;
  }

  handleLeftClick(q: number, r: number, shiftKey = false): boolean {
    if (shiftKey && this.isSelected()) {
      return this.orderMove(q, r);
    }
    if (this.latestHq && isTileNearHq(this.latestHq, q, r)) {
      this.selectHq();
      return true;
    }
    return false;
  }

  handleRightClick(q: number, r: number): boolean {
    return this.orderMove(q, r);
  }

  bindCanvas(canvas: HTMLElement, pickTile: TilePicker | undefined = this.pickTile): () => void {
    if (pickTile) this.pickTile = pickTile;
    let down = { x: 0, y: 0, button: -1 };
    let lastRight = { at: -1000, q: NaN, r: NaN };
    // One right-click is one order. Browsers fire `contextmenu` on mouse-down (macOS) or mouse-up (Windows) next to
    // `pointerup`, so both handlers route here and the second of the pair is dropped.
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
