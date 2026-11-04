import type { CompiledDataLike } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { dispatchCommand, type CommandSink, type DispatchedCommand, type InProcessHost } from '../shared/commandDispatch';
import { bindExclusivePointer, resolvePointerTile, type TileCoord, type TilePickerFn } from '../shared/pointer';
import {
  extractViewEntities,
  hasWorkerEntity,
  type PlannedTileJob,
  type TerraformPrimaryOp,
} from './planner';
import { planPrimaryOp, type BrushStrokeOutcome, type TerraformWireArgs, type WorkIntent } from './primaryOps';

export type { BrushStrokeOutcome, TerraformPrimaryOp, TerraformWireArgs, TileCoord, WorkIntent };

export interface BrushStrokeOptions {
  op?: TerraformPrimaryOp;
  colonyId?: number;
}

export interface BrushStrokeSummary {
  /** Client-side id of this stroke (status line only; never sent: the host names its own order). */
  strokeId: string;
  op: TerraformPrimaryOp;
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
  /** The selected own unit, sent as `workerId` of REPAIR (`undefined`: the host picks the worker). */
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
/** macOS fires `contextmenu` right after a Ctrl+click press: it is a queue click, not a disarming right click. */
const CTRL_CLICK_CONTEXT_MS = 800;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Terraform brush: picks one of the 3 ops (TERRAFORM / REPAIR / DISMANTLE), previews a click and sends one command
 * per click. Map clicks act only while the brush is armed; Esc or right click disarms it. A plain click that sent an
 * order disarms it (one armed click = one order, like the construction ghost); Ctrl (or Cmd) + click sends the order
 * and stays armed, so several hexes can be queued one after another. A click the preview refuses keeps the brush
 * armed for another hex. The host's reject of the newest order replaces its status.
 */
export class BrushController {
  private selectedOp: TerraformPrimaryOp = 'terraform';
  private armed = false;
  private lastStroke: BrushStrokeSummary | null = null;
  private lastOutcome: BrushStrokeOutcome | null = null;
  private pressTile: TileCoord | null = null;
  private lastCtrlPressAt = -Infinity;
  private currentView: GameView | null = null;
  private cleanups: Array<() => void> = [];

  constructor(private readonly sink: BrushCommandSink = {}) {}

  /** Chooses the op and arms the brush. */
  selectOp(op: TerraformPrimaryOp): void {
    this.selectedOp = op;
    this.armed = true;
    this.sink.onChange?.();
  }

  getSelectedOp(): TerraformPrimaryOp {
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

  /** True when the player has an alive HQ Drone, Harvester, Builder, or Terraformer available to execute terraform/work tasks. */
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
    this.lastOutcome = plan.outcome;
    const summary: BrushStrokeSummary = {
      strokeId: `tf_stroke_${++strokeSeq}`,
      op,
      tiles: [tile],
      jobs: plan.job ? [plan.job] : [],
      queuedCount: plan.terraform ? 1 : 0,
      skippedCount: plan.terraform ? 0 : 1,
      ...(plan.outcome.status ? { statusText: plan.outcome.status } : {}),
      outcome: plan.outcome,
    };
    this.lastStroke = summary;
    this.sink.onStroke?.(summary);
    this.sink.onChange?.();
    this.watchVerdict(sent, summary.strokeId);
    return summary;
  }

  /** The command bus answers this very command: a reject (or timeout) shows on the status line while it is the newest. */
  private watchVerdict(sent: DispatchedCommand | null, strokeId: string): void {
    void sent?.result.then((r) => {
      if (r && !r.ok) this.noteRejected(r.code ?? 'rejected', strokeId);
    });
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

  /** Map clicks belong to the brush: armed and not blocked (another map mode, or its dock tab hidden). */
  isPointerActive(): boolean {
    return this.armed && !this.sink.isBlocked?.();
  }

  /**
   * Binds click input on `surface`. Left clicks belong to the brush only while it is armed (Ctrl / Cmd + click queues
   * and keeps it armed). A right click disarms it and still reaches the map below (a unit move order is not swallowed).
   */
  bindSurface(surface: HTMLElement, pickTile?: TilePickerFn): () => void {
    const offLeft = bindExclusivePointer(
      surface,
      () => this.isPointerActive(),
      {
        down: (e) => {
          if (e.ctrlKey) this.lastCtrlPressAt = now();
          this.pressTile = resolvePointerTile(e, pickTile);
        },
        up: (e) => {
          if (!this.pressTile) return;
          const tile = resolvePointerTile(e, pickTile) ?? this.pressTile;
          this.pressTile = null;
          const queue = e.ctrlKey || e.metaKey;
          if (this.strokeTile(tile.q, tile.r).queuedCount > 0 && !queue) this.disarm();
        },
      },
      LEFT_ONLY,
    );
    const onRight = (ev: Event) => {
      if (!this.isPointerActive()) return;
      if (ev.type === 'contextmenu' && now() - this.lastCtrlPressAt < CTRL_CLICK_CONTEXT_MS) {
        ev.preventDefault(); // macOS Ctrl+click: no browser menu, the brush stays armed
        return;
      }
      if (ev.type === 'contextmenu' || (ev as MouseEvent).button === 2) this.disarm();
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
