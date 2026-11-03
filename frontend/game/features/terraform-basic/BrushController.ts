import type { CompiledDataLike } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { dispatchCommand, type CommandSink, type DispatchedCommand, type InProcessHost } from '../shared/commandDispatch';
import { bindExclusivePointer, resolvePointerTile, type TileCoord, type TilePickerFn } from '../shared/pointer';
import {
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
 * Terraform brush: picks an op (TERRAFORM / REPAIR / DISMANTLE, plus the S0 ops `grade` / `clear` / `break` through the
 * API), previews a click and sends one command per click. Map clicks act only while the brush is armed; Esc or right
 * click disarms it, and so does a map click that sent an order (one armed click = one order, like the construction
 * ghost: TERRAFORM is a continuous order the host chains hex by hex, so the next click selects again). A click the
 * preview refuses keeps the brush armed for another hex. The host's reject of the newest order replaces its status.
 */
export class BrushController {
  private selectedOp: BrushOpSelection = 'terraform';
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
    this.armed = true;
    this.sink.onChange?.();
  }

  getSelectedOp(): BrushOpSelection {
    return this.selectedOp;
  }

  isArmed(): boolean {
    return this.armed;
  }

  /** Map clicks stop acting (Esc, right click). */
  disarm(): void {
    this.armed = false;
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

  /** True when the player has an alive HQ Drone or Harvester available to execute terraform/work tasks. */
  hasWorkerAvailable(view?: GameView | null): boolean {
    const resolved = view ?? this.resolveView();
    const entities = extractViewEntities(resolved, this.sink.host?.state);
    return hasWorkerEntity(entities, this.colonyId(), resolved);
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
    return isPrimaryOp(op) ? this.executePrimary(op, tile, opts) : this.executeStroke(op, tile, opts);
  }

  private recordStroke(
    op: BrushOpSelection,
    tile: TileCoord,
    jobs: PlannedTileJob[],
    queuedCount: number,
    outcome: BrushStrokeOutcome,
  ): BrushStrokeSummary {
    this.lastOutcome = outcome;
    const summary: BrushStrokeSummary = {
      strokeId: `tf_stroke_${++strokeSeq}`,
      op,
      tiles: [tile],
      jobs,
      queuedCount,
      skippedCount: queuedCount > 0 ? 0 : 1,
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
    const summary = this.recordStroke(op, tile, plan.job ? [plan.job] : [], plan.terraform ? 1 : 0, plan.outcome);
    this.watchVerdict(sent, summary.strokeId);
    return summary;
  }

  /** The command bus answers this very command: a reject (or timeout) shows on the status line while it is the newest. */
  private watchVerdict(sent: DispatchedCommand | null, strokeId: string): void {
    void sent?.result.then((r) => {
      if (r && !r.ok) this.noteRejected(r.code ?? 'rejected', strokeId);
    });
  }

  /** A concrete S0 op (`grade` / `clear` / `break`) on one tile, previewed with the sim's own rule. */
  private executeStroke(op: TerraformOpId, tile: TileCoord, opts?: BrushStrokeOptions): BrushStrokeSummary {
    const colonyId = this.colonyId(opts);
    const planned = planBrushStroke(this.resolveView(), [tile], { op, colonyId, data: this.sink.simData?.() ?? undefined });
    const sent = planned.queuedCount > 0 ? dispatchCommand(this.sink, 'enqueueTask', { terraform: { op, tiles: [tile] } }, colonyId) : null;
    const outcome: BrushStrokeOutcome = { ok: planned.queuedCount > 0, op };
    const summary = this.recordStroke(op, tile, planned.jobs, planned.queuedCount, outcome);
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

  private isPointerActive(): boolean {
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
          const tile = resolvePointerTile(e, pickTile) ?? this.pressTile;
          this.pressTile = null;
          if (this.strokeTile(tile.q, tile.r).queuedCount > 0) this.disarm();
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
