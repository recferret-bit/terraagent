import {
  cancelTerraformOrder,
  enqueueTerraformOrder,
  hexIndex,
  inHex,
  isTerraformOpKind,
  PREP,
  TERRAIN,
  type PlanetState,
  type TerraformOpKind,
  type TerraformOrder,
} from '@terra/sim';
import type { GameView } from '../../core/registry/types';

export type BrushMode = 'single' | 'area';
export type BrushOpSelection = TerraformOpKind | 'auto';

export interface TileCoord {
  q: number;
  r: number;
}

export interface BrushStrokeOptions {
  op?: BrushOpSelection;
  autoPrepare?: boolean;
  strictOp?: boolean;
  colonyId?: number;
  taskId?: string;
}

export interface PlannedTileJob {
  q: number;
  r: number;
  op: TerraformOpKind;
}

export interface BrushStrokeSummary {
  taskId: string;
  op: BrushOpSelection;
  mode: BrushMode;
  tiles: TileCoord[];
  jobs: PlannedTileJob[];
  queuedCount: number;
  skippedCount: number;
}

export interface BrushCommandSink {
  sendCommand?: (kind: string, args?: unknown) => unknown;
  store?: {
    latest?: GameView | null;
    latestTiles?: GameView['tiles'] | null;
    sendCommand?: (cmdOrKind: unknown, args?: unknown) => unknown;
  };
  host?: {
    readonly state: PlanetState;
    readonly pending: number;
    submit(cmd: {
      colonyIndex: number | null;
      source: 'player';
      commandId: string;
      kind: string;
      args: unknown;
    }): void;
    view(): GameView;
  };
  state?: PlanetState;
  colonyId?: number;
  onStroke?: (summary: BrushStrokeSummary) => void;
  onChange?: () => void;
}

/**
 * Computes all axial coordinates `(q, r)` in the rectangular box from `start` to `end`
 * in deterministic row-major order (`r` ascending, then `q` ascending).
 */
export function computeBoxTiles(start: TileCoord, end: TileCoord, radius?: number): TileCoord[] {
  const minQ = Math.min(Math.trunc(start.q), Math.trunc(end.q));
  const maxQ = Math.max(Math.trunc(start.q), Math.trunc(end.q));
  const minR = Math.min(Math.trunc(start.r), Math.trunc(end.r));
  const maxR = Math.max(Math.trunc(start.r), Math.trunc(end.r));
  const out: TileCoord[] = [];
  for (let r = minR; r <= maxR; r++) {
    for (let q = minQ; q <= maxQ; q++) {
      if (radius !== undefined && !inHex(q, r, radius)) continue;
      out.push({ q, r });
    }
  }
  return out;
}

function hasClaimedInTiles(ownerLayer: Int8Array, colonyId: number): boolean {
  for (let i = 0; i < ownerLayer.length; i++) {
    if (ownerLayer[i] === colonyId) return true;
  }
  return false;
}

function isOpValidForTerrainPrep(op: TerraformOpKind, terrain: number, prep: number): boolean {
  if (op === 'grade') {
    return (
      terrain === TERRAIN.flat &&
      prep !== PREP.prepared &&
      prep !== PREP.living &&
      prep !== PREP.ridge &&
      prep !== PREP.moat
    );
  }
  if (op === 'clear') return terrain === TERRAIN.forest;
  if (op === 'break') return terrain === TERRAIN.rock;
  return false;
}

/**
 * Evaluates a list of brushed tiles against the current `GameView` tile layers, returning
 * the valid `PlannedTileJob`s and `skippedCount`.
 */
export function planBrushStroke(
  view: GameView | null | undefined,
  tiles: readonly TileCoord[],
  opts: { op: BrushOpSelection; autoPrepare: boolean; colonyId: number },
): { jobs: PlannedTileJob[]; queuedCount: number; skippedCount: number } {
  const tileLayers = view?.tiles;
  const radius = view?.planet?.radius;
  if (!tileLayers || typeof radius !== 'number') {
    const fallbackOp: TerraformOpKind = opts.op === 'auto' ? 'grade' : opts.op;
    const jobs = tiles.map((t) => ({ q: t.q, r: t.r, op: fallbackOp }));
    return { jobs, queuedCount: jobs.length, skippedCount: 0 };
  }

  const idx = hexIndex(radius);
  const claimed = hasClaimedInTiles(tileLayers.owner, opts.colonyId);
  const jobs: PlannedTileJob[] = [];
  let skippedCount = 0;

  for (const tile of tiles) {
    const tileIdx = idx.indexOf(tile.q, tile.r);
    if (tileIdx < 0 || tileIdx >= tileLayers.count) {
      skippedCount++;
      continue;
    }
    const owner = tileLayers.owner[tileIdx];
    if ((owner >= 0 && owner !== opts.colonyId) || (owner === -1 && claimed)) {
      skippedCount++;
      continue;
    }
    const terrain = tileLayers.terrain[tileIdx];
    const prep = tileLayers.prep[tileIdx];
    let resolvedOp: TerraformOpKind | null = null;
    if (opts.autoPrepare || opts.op === 'auto') {
      if (terrain === TERRAIN.flat) resolvedOp = 'grade';
      else if (terrain === TERRAIN.forest) resolvedOp = 'clear';
      else if (terrain === TERRAIN.rock) resolvedOp = 'break';
    } else if (isTerraformOpKind(opts.op)) {
      resolvedOp = opts.op;
    }
    if (!resolvedOp || !isOpValidForTerrainPrep(resolvedOp, terrain, prep)) {
      skippedCount++;
      continue;
    }
    jobs.push({ q: tile.q, r: tile.r, op: resolvedOp });
  }

  return { jobs, queuedCount: jobs.length, skippedCount };
}

let strokeSeq = 0;

export class BrushController {
  private selectedOp: BrushOpSelection = 'grade';
  private brushMode: BrushMode = 'single';
  private lastStroke: BrushStrokeSummary | null = null;
  private brushedTiles: TileCoord[] = [];
  private previewTiles: TileCoord[] = [];
  private dragStart: TileCoord | null = null;
  private dragCurrent: TileCoord | null = null;
  private isDragging = false;
  private currentView: GameView | null = null;
  private cleanups: Array<() => void> = [];

  constructor(private readonly sink: BrushCommandSink = {}) {}

  selectOp(op: BrushOpSelection): void {
    this.selectedOp = op;
    this.sink.onChange?.();
  }

  getSelectedOp(): BrushOpSelection {
    return this.selectedOp;
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
    if (this.currentView?.tiles) return this.currentView;
    if (this.sink.store?.latest?.tiles) return this.sink.store.latest;
    if (this.sink.host) return this.sink.host.view();
    return this.currentView ?? this.sink.store?.latest ?? null;
  }

  /** Performs a single-tile (1x1) brush stroke and dispatches one `enqueueTask` order. */
  strokeTile(q: number, r: number, opts?: BrushStrokeOptions): BrushStrokeSummary {
    return this.executeStroke([{ q: Math.trunc(q), r: Math.trunc(r) }], 'single', {
      strictOp: true,
      ...opts,
    });
  }

  /** Performs an area box brush stroke from `from` to `to` and dispatches one `enqueueTask` order. */
  strokeArea(from: TileCoord, to: TileCoord, opts?: BrushStrokeOptions): BrushStrokeSummary {
    const view = this.resolveView();
    const tiles = computeBoxTiles(from, to, view?.planet?.radius);
    return this.executeStroke(tiles, 'area', opts);
  }

  private executeStroke(tiles: TileCoord[], mode: BrushMode, opts?: BrushStrokeOptions): BrushStrokeSummary {
    const op = opts?.op ?? this.selectedOp;
    const colonyId = opts?.colonyId ?? this.sink.colonyId ?? 0;
    const taskId = opts?.taskId ?? `tf_stroke_${++strokeSeq}`;
    const autoPrepare =
      opts?.autoPrepare ??
      (opts?.strictOp === true ? false : op === 'auto' || (mode === 'area' && op === 'grade'));

    const view = this.resolveView();
    let planned = planBrushStroke(view, tiles, { op, autoPrepare, colonyId });

    const commandOp: TerraformOpKind = op === 'auto' ? 'grade' : op;
    const wireTiles = tiles.map((t) => ({ q: t.q, r: t.r }));
    const commandArgs = {
      terraform: { op: commandOp, tiles: wireTiles },
      ...(opts?.strictOp === true ? { autoPrepare: false } : autoPrepare ? { autoPrepare: true } : {}),
    };

    const simOrder = this.dispatchEnqueue(commandArgs, {
      colonyId,
      op,
      autoPrepare,
      tiles: wireTiles,
      taskId,
    });
    if (simOrder) {
      planned = {
        jobs: simOrder.jobs.map((j) => ({ q: j.q, r: j.r, op: j.op })),
        queuedCount: simOrder.jobs.length,
        skippedCount: simOrder.skippedCount,
      };
    }

    const summary: BrushStrokeSummary = {
      taskId,
      op,
      mode,
      tiles,
      jobs: planned.jobs,
      queuedCount: planned.queuedCount,
      skippedCount: planned.skippedCount,
    };
    this.lastStroke = summary;
    this.brushedTiles = tiles;
    this.previewTiles = [];
    this.sink.onStroke?.(summary);
    this.sink.onChange?.();
    return summary;
  }

  private dispatchEnqueue(
    commandArgs: { terraform: { op: TerraformOpKind; tiles: TileCoord[] }; autoPrepare?: boolean },
    simOpts: {
      colonyId: number;
      op: BrushOpSelection;
      autoPrepare: boolean;
      tiles: TileCoord[];
      taskId: string;
    },
  ): TerraformOrder | undefined {
    const pendingBefore = this.sink.host?.pending ?? 0;
    if (this.sink.sendCommand) {
      void this.sink.sendCommand('enqueueTask', { terraform: commandArgs.terraform });
    }
    if (this.sink.store?.sendCommand && this.sink.store.sendCommand !== this.sink.sendCommand) {
      this.sink.store.sendCommand(
        {
          type: 'enqueueTask',
          kind: 'enqueueTask',
          commandId: simOpts.taskId,
          terraform: commandArgs.terraform,
          args: commandArgs,
        },
        commandArgs,
      );
    }
    const targetState = this.sink.state ?? this.sink.host?.state;
    const hostPendingAfter = this.sink.host?.pending ?? 0;
    if (targetState && hostPendingAfter === pendingBefore) {
      const res = enqueueTerraformOrder(targetState, {
        colonyId: simOpts.colonyId,
        op: simOpts.op,
        autoPrepare: simOpts.autoPrepare,
        tiles: simOpts.tiles,
        orderId: simOpts.taskId,
        taskId: simOpts.taskId,
      });
      return res.order;
    }
    return undefined;
  }

  /** Cancels the active or specified terraform order. */
  cancelOrder(taskId?: string): void {
    const resolvedId = taskId ?? this.lastStroke?.taskId ?? 'active';
    const colonyId = this.sink.colonyId ?? 0;
    const pendingBefore = this.sink.host?.pending ?? 0;
    if (this.sink.sendCommand) {
      void this.sink.sendCommand('cancelTask', { taskId: resolvedId });
    }
    if (this.sink.store?.sendCommand && this.sink.store.sendCommand !== this.sink.sendCommand) {
      this.sink.store.sendCommand(
        { type: 'cancelTask', kind: 'cancelTask', taskId: resolvedId, args: { taskId: resolvedId } },
        { taskId: resolvedId },
      );
    }
    const targetState = this.sink.state ?? this.sink.host?.state;
    const hostPendingAfter = this.sink.host?.pending ?? 0;
    if (targetState && hostPendingAfter === pendingBefore) {
      cancelTerraformOrder(targetState, colonyId, taskId);
    }
    this.sink.onChange?.();
  }

  /** Binds pointer events on an interactive surface element for click/drag brushing. */
  bindSurface(
    surface: HTMLElement,
    pickTile?: (clientX: number, clientY: number, target?: EventTarget | null) => TileCoord | null,
  ): () => void {
    const resolveCoord = (e: PointerEvent): TileCoord | null => {
      if (pickTile) {
        const picked = pickTile(e.clientX ?? 0, e.clientY ?? 0, e.target);
        if (picked) return picked;
      }
      const el = e.target as HTMLElement | null;
      const qAttr = el?.dataset?.q ?? el?.getAttribute?.('data-q');
      const rAttr = el?.dataset?.r ?? el?.getAttribute?.('data-r');
      if (qAttr !== undefined && qAttr !== null && rAttr !== undefined && rAttr !== null) {
        const q = Number(qAttr);
        const r = Number(rAttr);
        if (Number.isFinite(q) && Number.isFinite(r)) return { q, r };
      }
      return null;
    };

    const onDown = (ev: unknown) => {
      const e = ev as PointerEvent;
      if (e.button !== undefined && e.button !== 0) return;
      const coord = resolveCoord(e);
      if (!coord) return;
      this.dragStart = coord;
      this.dragCurrent = coord;
      this.isDragging = true;
      this.previewTiles = [coord];
      this.sink.onChange?.();
    };

    const onMove = (ev: unknown) => {
      if (!this.isDragging || !this.dragStart) return;
      const coord = resolveCoord(ev as PointerEvent);
      if (!coord) return;
      this.dragCurrent = coord;
      this.previewTiles =
        this.brushMode === 'area' ? computeBoxTiles(this.dragStart, coord) : [coord];
      this.sink.onChange?.();
    };

    const onUp = (ev: unknown) => {
      if (!this.isDragging || !this.dragStart) return;
      const e = ev as PointerEvent;
      if (e.button !== undefined && e.button !== 0) return;
      const end = resolveCoord(e) ?? this.dragCurrent ?? this.dragStart;
      const start = this.dragStart;
      this.isDragging = false;
      this.dragStart = null;
      this.dragCurrent = null;
      if (this.brushMode === 'single') {
        this.strokeTile(end.q, end.r);
      } else {
        this.strokeArea(start, end);
      }
    };

    surface.addEventListener('pointerdown', onDown as EventListener);
    surface.addEventListener('pointermove', onMove as EventListener);
    surface.addEventListener('pointerup', onUp as EventListener);
    const cleanup = () => {
      surface.removeEventListener('pointerdown', onDown as EventListener);
      surface.removeEventListener('pointermove', onMove as EventListener);
      surface.removeEventListener('pointerup', onUp as EventListener);
    };
    this.cleanups.push(cleanup);
    return cleanup;
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
  }
}
