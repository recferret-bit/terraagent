import { parseCommandArgs } from '@terra/contracts';
import type { CompiledDataLike } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { dispatchCommand, type CommandSink, type InProcessHost } from '../shared/commandDispatch';
import { bindExclusivePointer, resolvePointerTile, type TileCoord, type TilePickerFn } from '../shared/pointer';
import { computeBoxTiles, planBrushStroke, type BrushOpSelection, type PlannedTileJob } from './planner';

export type BrushMode = 'single' | 'area';
export type { TileCoord };

export interface BrushStrokeOptions {
  op?: BrushOpSelection;
  colonyId?: number;
}

export interface BrushStrokeSummary {
  /** Client-side id of this stroke (status line only; never sent: the host names its own order). */
  strokeId: string;
  op: BrushOpSelection;
  mode: BrushMode;
  tiles: TileCoord[];
  jobs: PlannedTileJob[];
  queuedCount: number;
  skippedCount: number;
  /** The stroke covered more tiles than one command may carry: nothing was sent. */
  tooLarge?: boolean;
}

export interface BrushCommandSink extends CommandSink {
  store?: CommandSink['store'] & {
    latest?: GameView | null;
    latestTiles?: GameView['tiles'] | null;
    simData?(): CompiledDataLike | null;
  };
  host?: InProcessHost;
  /** The player's colony, read per stroke (FF-05). */
  getColonyId?: () => number;
  /** Another map mode owns the pointer (the Hub placement ghost): the armed brush leaves clicks alone. */
  isBlocked?: () => boolean;
  /** The host's live balance data (`WorldStore.simData`), so the preview runs the same numbers. */
  simData?: () => CompiledDataLike | null | undefined;
  onStroke?: (summary: BrushStrokeSummary) => void;
  onChange?: () => void;
}

let strokeSeq = 0;

/**
 * Terraform brush: picks an op, previews a stroke and sends one `enqueueTask` per stroke through exactly one channel.
 * Map clicks paint only while the brush is armed (an op chosen by button or hotkey); Esc or a right click disarms it.
 */
export class BrushController {
  private selectedOp: BrushOpSelection = 'grade';
  private armed = false;
  private brushMode: BrushMode = 'single';
  private lastStroke: BrushStrokeSummary | null = null;
  private brushedTiles: TileCoord[] = [];
  private previewTiles: TileCoord[] = [];
  private dragStart: TileCoord | null = null;
  private dragCurrent: TileCoord | null = null;
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

  /** Map clicks stop painting (Esc, right click). */
  disarm(): void {
    this.armed = false;
    this.dragStart = null;
    this.dragCurrent = null;
    this.previewTiles = [];
    this.sink.onChange?.();
  }

  setBrushMode(mode: BrushMode): void {
    this.brushMode = mode;
    this.sink.onChange?.();
  }

  getBrushMode(): BrushMode {
    return this.brushMode;
  }

  getLastStroke(): BrushStrokeSummary | null {
    return this.lastStroke;
  }

  getBrushedTiles(): readonly TileCoord[] {
    return this.brushedTiles;
  }

  getPreviewTiles(): readonly TileCoord[] {
    return this.previewTiles;
  }

  setView(view: GameView | null): void {
    this.currentView = view;
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

  /** Performs a single-tile (1x1) brush stroke and dispatches one `enqueueTask` order. */
  strokeTile(q: number, r: number, opts?: BrushStrokeOptions): BrushStrokeSummary {
    return this.executeStroke([{ q: Math.trunc(q), r: Math.trunc(r) }], 'single', opts);
  }

  /** Performs an area box brush stroke from `from` to `to` and dispatches one `enqueueTask` order. */
  strokeArea(from: TileCoord, to: TileCoord, opts?: BrushStrokeOptions): BrushStrokeSummary {
    const view = this.resolveView();
    const tiles = computeBoxTiles(from, to, view?.planet?.radius);
    return this.executeStroke(tiles, 'area', opts);
  }

  private executeStroke(tiles: TileCoord[], mode: BrushMode, opts?: BrushStrokeOptions): BrushStrokeSummary {
    const op = opts?.op ?? this.selectedOp;
    const colonyId = this.colonyId(opts);
    const view = this.resolveView();
    const args = { terraform: { op, tiles: tiles.map((t) => ({ q: t.q, r: t.r })) } };
    // The contract bounds a stroke (tile count); one the host would reject as a whole is not sent (FF-33).
    const tooLarge = !parseCommandArgs('enqueueTask', args).success;
    const planned = tooLarge
      ? { jobs: [], queuedCount: 0, skippedCount: tiles.length }
      : planBrushStroke(view, tiles, { op, colonyId, data: this.sink.simData?.() ?? undefined });
    if (!tooLarge) dispatchCommand(this.sink, 'enqueueTask', args, colonyId);

    const summary: BrushStrokeSummary = {
      strokeId: `tf_stroke_${++strokeSeq}`,
      op,
      mode,
      tiles,
      jobs: planned.jobs,
      queuedCount: planned.queuedCount,
      skippedCount: planned.skippedCount,
      ...(tooLarge ? { tooLarge: true } : {}),
    };
    this.lastStroke = summary;
    this.brushedTiles = tiles;
    this.previewTiles = [];
    this.sink.onStroke?.(summary);
    this.sink.onChange?.();
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

  /** Binds click / drag brushing on `surface`; clicks belong to the brush only while it is armed. */
  bindSurface(surface: HTMLElement, pickTile?: TilePickerFn): () => void {
    const cleanup = bindExclusivePointer(surface, () => this.isPointerActive(), {
      down: (e) => {
        if (e.button !== 0) return;
        const coord = resolvePointerTile(e, pickTile);
        if (!coord) return;
        this.dragStart = coord;
        this.dragCurrent = coord;
        this.previewTiles = [coord];
        this.sink.onChange?.();
      },
      move: (e) => {
        if (!this.dragStart) return;
        const coord = resolvePointerTile(e, pickTile);
        if (!coord || (this.dragCurrent && coord.q === this.dragCurrent.q && coord.r === this.dragCurrent.r)) return;
        this.dragCurrent = coord;
        this.previewTiles = this.brushMode === 'area' ? computeBoxTiles(this.dragStart, coord) : [coord];
        this.sink.onChange?.();
      },
      up: (e) => {
        if (e.button !== 0 || !this.dragStart) return;
        const end = resolvePointerTile(e, pickTile) ?? this.dragCurrent ?? this.dragStart;
        const start = this.dragStart;
        this.dragStart = null;
        this.dragCurrent = null;
        if (this.brushMode === 'single') this.strokeTile(end.q, end.r);
        else this.strokeArea(start, end);
      },
      context: () => this.disarm(),
    });
    this.cleanups.push(cleanup);
    return cleanup;
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
  }
}
