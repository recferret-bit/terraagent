import { hexIndex, PREP, TERRAIN, type TerraformOpKind, type TerraformOrder } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { TileCoord } from './BrushController';
import { ensureDom } from './dom';

export type TilePrepStateName = 'wild' | 'flat' | 'prepared' | 'irrigated' | 'living' | 'ridge' | 'moat';

export interface OverlayJobEntry {
  orderId: string;
  q: number;
  r: number;
  op: TerraformOpKind;
  progress: number;
  percent: number;
  status: 'in_progress' | 'queued';
}

export interface OverlayOrderProgress {
  orderId: string;
  op: TerraformOpKind;
  totalJobs: number;
  completedJobs: number;
  remainingJobs: number;
  skippedCount: number;
  currentJob: OverlayJobEntry | null;
  overallProgress: number;
  overallPercent: number;
}

export interface OverlayTileEntry {
  q: number;
  r: number;
  state: TilePrepStateName;
  terrain: string;
  op?: TerraformOpKind;
  progress: number;
  percent: number;
}

export interface TileOverlayState {
  visible: boolean;
  counts: {
    wild: number;
    flat: number;
    prepared: number;
    living: number;
    other: number;
  };
  activeOrder: OverlayOrderProgress | null;
  orders: OverlayOrderProgress[];
  jobs: OverlayJobEntry[];
  tiles: OverlayTileEntry[];
  progress: number;
  percent: number;
}

function prepCodeToName(code: number): TilePrepStateName {
  if (code === PREP.flat) return 'flat';
  if (code === PREP.prepared) return 'prepared';
  if (code === PREP.irrigated) return 'irrigated';
  if (code === PREP.living) return 'living';
  if (code === PREP.ridge) return 'ridge';
  if (code === PREP.moat) return 'moat';
  return 'wild';
}

function terrainCodeToName(code: number): string {
  if (code === TERRAIN.forest) return 'forest';
  if (code === TERRAIN.rock) return 'rock';
  if (code === TERRAIN.slope) return 'slope';
  if (code === TERRAIN.hole) return 'hole';
  if (code === TERRAIN.shallow) return 'shallow';
  if (code === TERRAIN.deep) return 'deep';
  return 'flat';
}

export function extractColonyOrders(view: GameView | null | undefined, colonyId: number): TerraformOrder[] {
  const raw = view?.blobs?.terraformTasks as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return [];
  const inner = (typeof raw.value === 'object' && raw.value !== null ? raw.value : raw) as {
    byColony?: Record<number, TerraformOrder[]>;
    orders?: TerraformOrder[];
    [k: number]: TerraformOrder[];
  };
  if (Array.isArray(inner.byColony?.[colonyId])) {
    return inner.byColony[colonyId].filter((o) => Array.isArray(o.jobs) && o.jobs.length > 0);
  }
  if (Array.isArray(inner[colonyId])) {
    return inner[colonyId].filter((o) => Array.isArray(o.jobs) && o.jobs.length > 0);
  }
  if (Array.isArray(inner.orders)) {
    return inner.orders.filter((o) => o.colonyId === colonyId && Array.isArray(o.jobs) && o.jobs.length > 0);
  }
  return [];
}

function buildOrderProgress(order: TerraformOrder): {
  summary: OverlayOrderProgress;
  jobEntries: OverlayJobEntry[];
} {
  const remainingJobs = order.jobs.length;
  const totalJobs = Math.max(remainingJobs, order.totalJobs ?? remainingJobs);
  const completedJobs = order.completedJobs ?? Math.max(0, totalJobs - remainingJobs);
  const jobEntries: OverlayJobEntry[] = order.jobs.map((j, idx) => {
    const clamped = Math.max(0, Math.min(1, Number(j.progress ?? 0)));
    return {
      orderId: order.orderId,
      q: j.q,
      r: j.r,
      op: j.op,
      progress: clamped,
      percent: Math.round(clamped * 100),
      status: idx === 0 ? 'in_progress' : 'queued',
    };
  });
  const currentJob = jobEntries[0] ?? null;
  const overallProgress =
    totalJobs > 0 ? Math.min(1, (completedJobs + (currentJob?.progress ?? 0)) / totalJobs) : 0;
  return {
    summary: {
      orderId: order.orderId,
      op: order.op,
      totalJobs,
      completedJobs,
      remainingJobs,
      skippedCount: order.skippedCount ?? 0,
      currentJob,
      overallProgress,
      overallPercent: Math.round(overallProgress * 100),
    },
    jobEntries,
  };
}

export function computeOverlayState(
  view: GameView | null | undefined,
  visible: boolean,
  colonyId: number,
  trackedTiles: readonly TileCoord[],
): TileOverlayState {
  const counts = { wild: 0, flat: 0, prepared: 0, living: 0, other: 0 };
  const tileLayers = view?.tiles;
  if (tileLayers?.prep) {
    for (let i = 0; i < tileLayers.count; i++) {
      const p = tileLayers.prep[i];
      if (p === PREP.wild) counts.wild++;
      else if (p === PREP.flat) counts.flat++;
      else if (p === PREP.prepared) counts.prepared++;
      else if (p === PREP.living) counts.living++;
      else counts.other++;
    }
  }

  const rawOrders = extractColonyOrders(view, colonyId);
  const orders: OverlayOrderProgress[] = [];
  const jobs: OverlayJobEntry[] = [];
  for (const o of rawOrders) {
    const built = buildOrderProgress(o);
    orders.push(built.summary);
    jobs.push(...built.jobEntries);
  }
  const activeOrder = orders[0] ?? null;

  const jobByCoord = new Map<string, OverlayJobEntry>();
  for (const j of jobs) {
    const key = `${j.q},${j.r}`;
    if (!jobByCoord.has(key)) jobByCoord.set(key, j);
  }

  const seenCoords = new Set<string>();
  const coordsToInspect: TileCoord[] = [];
  for (const j of jobs) {
    const key = `${j.q},${j.r}`;
    if (!seenCoords.has(key)) {
      seenCoords.add(key);
      coordsToInspect.push({ q: j.q, r: j.r });
    }
  }
  for (const t of trackedTiles) {
    const key = `${t.q},${t.r}`;
    if (!seenCoords.has(key)) {
      seenCoords.add(key);
      coordsToInspect.push(t);
    }
  }

  const radius = view?.planet?.radius;
  const idx = typeof radius === 'number' ? hexIndex(radius) : null;
  const tiles: OverlayTileEntry[] = [];
  for (const c of coordsToInspect) {
    const tileIdx = idx ? idx.indexOf(c.q, c.r) : -1;
    const prepCode = tileLayers && tileIdx >= 0 ? tileLayers.prep[tileIdx] : PREP.wild;
    const terrainCode = tileLayers && tileIdx >= 0 ? tileLayers.terrain[tileIdx] : TERRAIN.flat;
    const state = prepCodeToName(prepCode);
    const job = jobByCoord.get(`${c.q},${c.r}`);
    const doneProgress = state === 'prepared' || state === 'flat' || state === 'living' ? 1 : 0;
    const progress = job ? job.progress : doneProgress;
    tiles.push({
      q: c.q,
      r: c.r,
      state,
      terrain: terrainCodeToName(terrainCode),
      ...(job ? { op: job.op } : {}),
      progress,
      percent: Math.round(progress * 100),
    });
  }

  const progress = activeOrder
    ? Math.max(activeOrder.currentJob?.progress ?? 0, activeOrder.overallProgress)
    : 0;
  return {
    visible,
    counts,
    activeOrder,
    orders,
    jobs,
    tiles,
    progress,
    percent: Math.round(progress * 100),
  };
}

export class TileOverlay {
  readonly el: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly jobsEl: HTMLElement;
  private visible = false;
  private lastView: GameView | null = null;
  private trackedTiles: readonly TileCoord[] = [];
  private state: TileOverlayState;

  constructor(parent: HTMLElement, private readonly colonyId = 0) {
    ensureDom();
    this.el = document.createElement('div');
    this.el.className = 'ta-tf-overlay plate-sm';
    this.el.dataset.testid = 'tf-tile-overlay';
    this.el.dataset.visible = 'false';
    this.el.hidden = true;

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'ta-tf-overlay__summary label';
    this.summaryEl.dataset.testid = 'tf-overlay-summary';

    this.progressEl = document.createElement('div');
    this.progressEl.className = 'ta-tf-overlay__progress mono';
    this.progressEl.dataset.testid = 'tf-overlay-progress';

    this.jobsEl = document.createElement('div');
    this.jobsEl.className = 'ta-tf-overlay__jobs';
    this.jobsEl.dataset.testid = 'tf-overlay-jobs';

    this.el.append(this.summaryEl, this.progressEl, this.jobsEl);
    parent.appendChild(this.el);

    this.state = computeOverlayState(null, false, this.colonyId, []);
    this.render();
  }

  setVisible(on?: boolean): boolean {
    this.visible = on ?? !this.visible;
    this.el.hidden = !this.visible;
    this.el.dataset.visible = String(this.visible);
    this.state = computeOverlayState(this.lastView, this.visible, this.colonyId, this.trackedTiles);
    this.render();
    return this.visible;
  }

  isVisible(): boolean {
    return this.visible;
  }

  getState(): TileOverlayState {
    return this.state;
  }

  update(view: GameView | null, trackedTiles?: readonly TileCoord[]): void {
    if (view) {
      this.lastView = view.tiles
        ? view
        : this.lastView?.tiles
          ? { ...view, tiles: this.lastView.tiles }
          : view;
    }
    if (trackedTiles) this.trackedTiles = trackedTiles;
    this.state = computeOverlayState(this.lastView, this.visible, this.colonyId, this.trackedTiles);
    this.render();
  }

  private render(): void {
    const { counts, activeOrder, tiles } = this.state;
    this.summaryEl.dataset.wild = String(counts.wild);
    this.summaryEl.dataset.flat = String(counts.flat);
    this.summaryEl.dataset.prepared = String(counts.prepared);
    this.summaryEl.dataset.living = String(counts.living);
    this.summaryEl.textContent = `WILD ${counts.wild} · FLAT ${counts.flat} · PREPARED ${counts.prepared}`;

    if (activeOrder) {
      const cur = activeOrder.currentJob;
      const curPct = cur ? cur.percent : activeOrder.overallPercent;
      const curLabel = cur ? `${cur.op.toUpperCase()} (${cur.q},${cur.r}) ${cur.percent}%` : 'DONE';
      this.progressEl.dataset.orderId = activeOrder.orderId;
      this.progressEl.dataset.completedJobs = String(activeOrder.completedJobs);
      this.progressEl.dataset.totalJobs = String(activeOrder.totalJobs);
      this.progressEl.dataset.remainingJobs = String(activeOrder.remainingJobs);
      this.progressEl.dataset.skippedCount = String(activeOrder.skippedCount);
      this.progressEl.dataset.currentPercent = String(curPct);
      this.progressEl.dataset.overallPercent = String(activeOrder.overallPercent);
      this.progressEl.textContent = `${activeOrder.completedJobs}/${activeOrder.totalJobs} JOBS · ${curLabel} · OVERALL ${activeOrder.overallPercent}%`;
    } else {
      this.progressEl.dataset.currentPercent = '0';
      this.progressEl.dataset.overallPercent = '0';
      this.progressEl.textContent = 'IDLE · NO ACTIVE TERRAFORM JOBS';
    }

    this.jobsEl.replaceChildren();
    for (const item of tiles.slice(0, 32)) {
      const chip = document.createElement('div');
      chip.className = 'ta-tf-overlay__tile mono';
      chip.dataset.testid = 'tf-overlay-tile';
      chip.dataset.q = String(item.q);
      chip.dataset.r = String(item.r);
      chip.dataset.state = item.state;
      chip.dataset.progress = String(item.percent);
      if (item.op) chip.dataset.op = item.op;
      chip.textContent = item.op
        ? `(${item.q},${item.r}) ${item.state.toUpperCase()} · ${item.op.toUpperCase()} ${item.percent}%`
        : `(${item.q},${item.r}) ${item.state.toUpperCase()}`;
      this.jobsEl.appendChild(chip);
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
