import type { CompiledDataLike } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { dispatchCommand, type CommandSink, type DispatchedCommand, type InProcessHost } from '../shared/commandDispatch';
import { bindExclusivePointer, resolvePointerTile, type TileCoord, type TilePickerFn } from '../shared/pointer';
import {
  colonyMaxWorkerTier,
  extractViewEntities,
  hasWorkerEntity,
  isPrimaryOp,
  planBrushStroke,
  type BrushOpSelection,
  type PlannedTileJob,
  type TerraformButtonOp,
  type TerraformOpId,
  type TerraformPrimaryOp,
} from './planner';
import { planPrimaryOp, type BrushStrokeOutcome, type TerraformWireArgs, type WorkIntent } from './primaryOps';
import { extractColonyOrders } from './TileOverlay';
import {
  hexRadiusTiles,
  rectTiles,
  resolveBrushAreaTiles,
  type BrushShape,
} from './w05MenuOps';
import { colonyWorkJobs } from './workStatus';

export { hexRadiusTiles, rectTiles, type BrushShape };
export type { BrushOpSelection, BrushStrokeOutcome, TerraformButtonOp, TerraformOpId, TerraformPrimaryOp, TerraformWireArgs, TileCoord, WorkIntent };

export interface BrushStrokeOptions {
  op?: BrushOpSelection;
  colonyId?: number;
}

export interface BrushStrokeSummary {
  /** Client-side id of this stroke (status line only; never sent: the host names its own order). */
  strokeId: string;
  op: BrushOpSelection;
  tiles: TileCoord[];
  jobs: PlannedTileJob[];
  queuedCount: number;
  skippedCount: number;
  statusText?: string;
  outcome?: BrushStrokeOutcome;
}

export interface BrushCommandSink extends CommandSink {
  store?: CommandSink['store'] & {
    latest?: GameView | null;
    latestTiles?: GameView['tiles'] | null;
    simData?(): CompiledDataLike | null;
  };
  host?: InProcessHost;
  /** Optional direct sender of the dock buttons' `enqueueTask { terraform }` args (mock senders in unit tests). */
  enqueueTerraform?: (terraform: TerraformWireArgs) => unknown;
  /** The player's colony, read per stroke (FF-05). */
  getColonyId?: () => number;
  /** The selected own unit, sent as `workerId` of TERRAFORM / REPAIR (`undefined`: the host picks the worker). */
  getWorkerId?: () => number | undefined;
  /** Another map mode owns the pointer (a placement ghost): the armed brush leaves clicks alone. */
  isBlocked?: () => boolean;
  /** The host's live balance data (`WorldStore.simData`), so the preview runs the same numbers. */
  simData?: () => CompiledDataLike | null | undefined;
  onStroke?: (summary: BrushStrokeSummary) => void;
  onChange?: () => void;
}

let strokeSeq = 0;
const LEFT_ONLY: ReadonlySet<number> = new Set([0]);

/**
 * Terraform brush: picks an op (TERRAFORM / REPAIR / DISMANTLE, plus the W01/W05 ops `grade` / `clear` / `break` /
 * `level` / `fill` / `reclaim` / `deepReclaim` / `irrigate` / `seed`), previews a click or area and sends one command
 * per stroke. Supports single-hex, hex-radius (`r=1`, `r=2`), and rectangle area brushes, plus cancelling orders in an area.
 */
export class BrushController {
  private selectedOp: BrushOpSelection = 'terraform';
  private brushShape: BrushShape = 'single';
  private cancelMode = false;
  private armed = false;
  private lastStroke: BrushStrokeSummary | null = null;
  private lastOutcome: BrushStrokeOutcome | null = null;
  private pressTile: TileCoord | null = null;
  private currentView: GameView | null = null;
  private cleanups: Array<() => void> = [];

  constructor(private readonly sink: BrushCommandSink = {}) {}

  /** Chooses the op and arms the brush. */
  selectOp(op: BrushOpSelection): void {
    this.selectedOp = op;
    this.cancelMode = false;
    this.armed = true;
    this.sink.onChange?.();
  }

  getSelectedOp(): BrushOpSelection {
    return this.selectedOp;
  }

  setBrushShape(shape: BrushShape): void {
    this.brushShape = shape;
    this.cancelMode = false;
    this.sink.onChange?.();
  }

  getBrushShape(): BrushShape {
    return this.brushShape;
  }

  setCancelMode(on: boolean): void {
    this.cancelMode = on;
    this.armed = on;
    this.sink.onChange?.();
  }

  isCancelMode(): boolean {
    return this.cancelMode;
  }

  isArmed(): boolean {
    return this.armed;
  }

  /** Map clicks stop acting (Esc, right click). */
  disarm(): void {
    this.armed = false;
    this.cancelMode = false;
    this.pressTile = null;
    this.sink.onChange?.();
  }

  getLastStroke(): BrushStrokeSummary | null {
    return this.lastStroke;
  }

  getLastOutcome(): BrushStrokeOutcome | null {
    return this.lastOutcome;
  }

  /** The host rejected the newest order (`strokeId`: only if it is still the newest): the status stops claiming it was ordered. */
  noteRejected(code: string, strokeId?: string): void {
    if (strokeId !== undefined && this.lastStroke?.strokeId !== strokeId) return;
    const status = `Rejected by host: ${code.replace(/_/g, ' ')}`;
    this.lastOutcome = { ...(this.lastOutcome ?? {}), ok: false, reason: code, status };
    if (this.lastStroke) this.lastStroke = { ...this.lastStroke, statusText: status, outcome: this.lastOutcome };
    this.sink.onChange?.();
  }

  setView(view: GameView | null): void {
    this.currentView = view;
  }

  /** The newest view the brush previews on (the menu's status line reads the colony's work jobs from it). */
  getView(): GameView | null {
    return this.resolveView();
  }

  /** True when the player has an alive HQ Drone, Harvester, Builder, or Terraformer available to execute terraform/work tasks. */
  hasWorkerAvailable(view?: GameView | null): boolean {
    const resolved = view ?? this.resolveView();
    const entities = extractViewEntities(resolved, this.sink.host?.state);
    return hasWorkerEntity(entities, this.colonyId(), resolved);
  }

  /** Highest worker tier owned by the colony (`1` in T1, `2` once a T2 worker exists; gates `deepReclaim`). */
  getMaxWorkerTier(view?: GameView | null): number {
    const resolved = view ?? this.resolveView();
    const entities = extractViewEntities(resolved, this.sink.host?.state);
    return colonyMaxWorkerTier(entities, this.colonyId(), resolved);
  }

  private resolveView(): GameView | null {
    const view = this.currentView ?? this.sink.store?.latest ?? this.sink.host?.view() ?? null;
    if (!view || view.tiles) return view;
    const tiles = this.sink.store?.latest?.tiles ?? this.sink.store?.latestTiles ?? null;
    return tiles ? { ...view, tiles } : view;
  }

  private colonyId(opts?: BrushStrokeOptions): number {
    return opts?.colonyId ?? this.sink.getColonyId?.() ?? 0;
  }

  /** One click at `(q, r)`: previews it and dispatches at most one `enqueueTask` order. */
  strokeTile(q: number, r: number, opts?: BrushStrokeOptions): BrushStrokeSummary {
    const tile = { q: Math.trunc(q), r: Math.trunc(r) };
    const op = opts?.op ?? this.selectedOp;
    return isPrimaryOp(op) ? this.executePrimary(op, tile, opts) : this.executeStroke(op, [tile], opts);
  }

  /** Strokes an array of tiles (area brush: hex radius or rectangle) and dispatches at most one `enqueueTask` order. */
  strokeArea(tiles: readonly TileCoord[], opts?: BrushStrokeOptions): BrushStrokeSummary {
    const norm = tiles.map((t) => ({ q: Math.trunc(t.q), r: Math.trunc(t.r) }));
    const op = opts?.op ?? this.selectedOp;
    if (norm.length === 1) {
      return isPrimaryOp(op) ? this.executePrimary(op, norm[0]!, opts) : this.executeStroke(op, norm, opts);
    }
    if (norm.length === 0) {
      return this.recordStroke(op, [], [], 0, { ok: false, op }, 0);
    }
    const wireOp: TerraformOpId = isPrimaryOp(op) ? (op === 'dismantle' ? 'dismantle' : 'grade') : op;
    return this.executeStroke(wireOp, norm, opts);
  }

  strokeHexRadius(q: number, r: number, radius: number, opts?: BrushStrokeOptions): BrushStrokeSummary {
    return this.strokeArea(hexRadiusTiles(q, r, radius), opts);
  }

  strokeRect(q1: number, r1: number, q2: number, r2: number, opts?: BrushStrokeOptions): BrushStrokeSummary {
    return this.strokeArea(rectTiles(q1, r1, q2, r2), opts);
  }

  private recordStroke(
    op: BrushOpSelection,
    tiles: readonly TileCoord[],
    jobs: PlannedTileJob[],
    queuedCount: number,
    outcome: BrushStrokeOutcome,
    skippedCount?: number,
  ): BrushStrokeSummary {
    this.lastOutcome = outcome;
    const summary: BrushStrokeSummary = {
      strokeId: `tf_stroke_${++strokeSeq}`,
      op,
      tiles: [...tiles],
      jobs,
      queuedCount,
      skippedCount: skippedCount ?? (queuedCount > 0 ? 0 : tiles.length),
      ...(outcome.status ? { statusText: outcome.status } : {}),
      outcome,
    };
    this.lastStroke = summary;
    this.sink.onStroke?.(summary);
    this.sink.onChange?.();
    return summary;
  }

  private executePrimary(op: TerraformPrimaryOp, tile: TileCoord, opts?: BrushStrokeOptions): BrushStrokeSummary {
    const colonyId = this.colonyId(opts);
    const view = this.resolveView();
    const hostState = this.sink.host?.state;
    const entities = extractViewEntities(view, hostState);
    const data = this.sink.simData?.() ?? null;
    const workerId = this.sink.getWorkerId?.();
    const plan = planPrimaryOp(op, { view, hostState, entities, colonyId, workerId, data }, tile.q, tile.r);
    let sent: DispatchedCommand | null = null;
    if (plan.terraform) {
      if (this.sink.enqueueTerraform) this.sink.enqueueTerraform(plan.terraform);
      else sent = dispatchCommand(this.sink, 'enqueueTask', { terraform: plan.terraform }, colonyId);
    }
    const summary = this.recordStroke(op, [tile], plan.job ? [plan.job] : [], plan.terraform ? 1 : 0, plan.outcome);
    this.watchVerdict(sent, summary.strokeId);
    return summary;
  }

  /** The command bus answers this very command: a reject (or timeout) shows on the status line while it is the newest. */
  private watchVerdict(sent: DispatchedCommand | null, strokeId: string): void {
    void sent?.result.then((r) => {
      if (r && !r.ok) this.noteRejected(r.code ?? 'rejected', strokeId);
    });
  }

  /** A concrete terraform op on one or more tiles, previewed with the sim's own rule. */
  private executeStroke(op: TerraformOpId, tiles: readonly TileCoord[], opts?: BrushStrokeOptions): BrushStrokeSummary {
    const colonyId = this.colonyId(opts);
    const view = this.resolveView();
    const planned = planBrushStroke(view, tiles, { op, colonyId, data: this.sink.simData?.() ?? undefined });
    const sent = planned.queuedCount > 0 ? dispatchCommand(this.sink, 'enqueueTask', { terraform: { op, tiles: [...tiles] } }, colonyId) : null;
    const outcome: BrushStrokeOutcome = { ok: planned.queuedCount > 0, op };
    const summary = this.recordStroke(op, tiles, planned.jobs, planned.queuedCount, outcome, planned.skippedCount);
    this.watchVerdict(sent, summary.strokeId);
    return summary;
  }

  /**
   * Cancels the host order `orderId` (the id the view carries). Without an id nothing is sent: the client never sends
   * a wildcard or an id the host does not know (FF-09). Returns whether a command was sent.
   */
  cancelOrder(orderId: string | undefined): boolean {
    if (!orderId) return false;
    dispatchCommand(this.sink, 'cancelTask', { taskId: orderId }, this.colonyId());
    this.sink.onChange?.();
    return true;
  }

  /**
   * Cancels queued terraform orders (and work jobs) of the colony that overlap `tiles` (or all open manual terraform
   * orders when `tiles` is omitted). Returns the number of orders cancelled.
   */
  cancelArea(tiles?: readonly TileCoord[]): number {
    const colonyId = this.colonyId();
    const view = this.resolveView();
    const hostTasks = this.sink.host?.state?.blobs?.terraformTasks?.value;
    const orders = [
      ...extractColonyOrders(view, colonyId),
      ...(hostTasks ? extractColonyOrders({ blobs: { terraformTasks: hostTasks } } as GameView, colonyId) : []),
    ];
    const tileSet =
      tiles && tiles.length > 0 ? new Set(tiles.map((t) => `${Math.trunc(t.q)},${Math.trunc(t.r)}`)) : null;
    const targetIds = new Set<string>();
    for (const order of orders) {
      if (order.isLinkedPrep) continue;
      if (!tileSet || order.jobs.some((j) => tileSet.has(`${j.q},${j.r}`))) {
        targetIds.add(order.orderId);
      }
    }
    for (const job of colonyWorkJobs(view, colonyId)) {
      if (!tileSet || tileSet.has(`${job.q},${job.r}`)) {
        targetIds.add(job.jobId);
      }
    }
    let cancelled = 0;
    for (const id of targetIds) {
      if (this.cancelOrder(id)) cancelled++;
    }
    return cancelled;
  }

  /** Map clicks belong to the brush: armed and not blocked (another map mode, or its dock tab hidden). */
  isPointerActive(): boolean {
    return this.armed && !this.sink.isBlocked?.();
  }

  /**
   * Binds click input on `surface`. Left clicks belong to the brush only while it is armed. A right click disarms it
   * and still reaches the map below (a unit move order is not swallowed).
   */
  bindSurface(surface: HTMLElement, pickTile?: TilePickerFn): () => void {
    const offLeft = bindExclusivePointer(
      surface,
      () => this.isPointerActive(),
      {
        down: (e) => {
          this.pressTile = resolvePointerTile(e, pickTile);
        },
        up: (e) => {
          if (!this.pressTile) return;
          const start = this.pressTile;
          const tile = resolvePointerTile(e, pickTile) ?? start;
          this.pressTile = null;
          if (this.cancelMode) {
            const area = resolveBrushAreaTiles(this.brushShape, start, tile, true);
            if (this.cancelArea(area) > 0) this.disarm();
            return;
          }
          if (this.brushShape === 'single') {
            if (this.strokeTile(tile.q, tile.r).queuedCount > 0) this.disarm();
            return;
          }
          const area = resolveBrushAreaTiles(this.brushShape, start, tile, false);
          if (this.strokeArea(area).queuedCount > 0) this.disarm();
        },
      },
      LEFT_ONLY,
    );
    const onRight = (ev: Event) => {
      if ((ev.type === 'contextmenu' || (ev as MouseEvent).button === 2) && this.isPointerActive()) this.disarm();
    };
    for (const type of ['pointerdown', 'contextmenu']) surface.addEventListener(type, onRight, { capture: true });
    const cleanup = () => {
      offLeft();
      for (const type of ['pointerdown', 'contextmenu']) surface.removeEventListener(type, onRight, { capture: true });
    };
    this.cleanups.push(cleanup);
    return cleanup;
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
  }
}
