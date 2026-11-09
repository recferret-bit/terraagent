import { hexIndex, PREP, TERRAIN, terraformOrdersOf, type TerraformOpKind, type TerraformOrder } from '@terra/sim';
import type { GameView } from '../../../core/registry/types';
import { colonyWorkJobs } from '../workStatus';

export type TilePrepStateName = 'wild' | 'flat' | 'prepared' | 'irrigated' | 'living' | 'ridge' | 'moat';
export type TileOverlayMode = 'all' | 'living';

export const LIVING_MOVE_SPEED_HINT = 'Living ground: +10 % ground move speed';
export const MAX_OVERLAY_CHIPS = 32;

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
  status?: 'in_progress' | 'waiting';
  waitReason?: 'resources' | 'power';
  waitingText?: string;
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

export interface TileOverlayCounts {
  wild: number;
  flat: number;
  prepared: number;
  irrigated: number;
  living: number;
  other: number;
}

export interface TileOverlayState {
  visible: boolean;
  mode?: TileOverlayMode;
  livingHint?: string;
  counts: TileOverlayCounts;
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

/** `colonyId`'s queued terraform orders in the view (`blobs.terraformTasks` is `{ byColony }`; the sim's own reader). */
export function extractColonyOrders(view: GameView | null | undefined, colonyId: number): readonly TerraformOrder[] {
  return terraformOrdersOf(view?.blobs?.terraformTasks, colonyId);
}

/** Open terraform `work` jobs, one overlay order each (the dock's chain; the W01 order queue stays as it is). */
function workChainOrders(view: GameView | null | undefined, colonyId: number): TerraformOrder[] {
  const out: TerraformOrder[] = [];
  for (const j of colonyWorkJobs(view, colonyId)) {
    if (j.mode !== 'terraform') continue;
    const wait = j.waitReason === 'resources' || j.waitReason === 'power' ? j.waitReason : undefined;
    out.push({
      orderId: j.jobId, taskId: j.jobId, colonyId, op: 'work', isLinkedPrep: false,
      jobs: [{ q: j.q, r: j.r, op: 'work', progress: Number(j.progress) || 0, baseTimeS: 0, totalEnergyE: 0, energyDrawnE: 0, ...(j.status ? { status: j.status } : {}), ...(wait ? { waitReason: wait } : {}) }],
      skippedCount: 0, totalJobs: 1, completedJobs: 0,
      ...(j.status ? { status: j.status } : {}),
      ...(wait ? { waitReason: wait } : {}),
    });
  }
  return out;
}

/** W01 terraform orders plus the colony's terraform `work` jobs, in that order. */
function overlayOrders(view: GameView | null | undefined, colonyId: number): readonly TerraformOrder[] {
  return [...extractColonyOrders(view, colonyId), ...workChainOrders(view, colonyId)];
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
  const waitReason = order.waitReason ?? order.jobs[0]?.waitReason;
  const status: 'in_progress' | 'waiting' =
    order.status === 'waiting' || order.jobs[0]?.status === 'waiting' || Boolean(waitReason)
      ? 'waiting'
      : 'in_progress';
  const waitingText = waitReason ? `waiting(${waitReason})` : undefined;
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
      status,
      ...(waitReason ? { waitReason, waitingText } : {}),
    },
    jobEntries,
  };
}

function countTilePreps(tileLayers: GameView['tiles']): TileOverlayCounts {
  const counts: TileOverlayCounts = { wild: 0, flat: 0, prepared: 0, irrigated: 0, living: 0, other: 0 };
  if (!tileLayers?.prep) return counts;
  for (let i = 0; i < tileLayers.count; i++) {
    const p = tileLayers.prep[i];
    if (p === PREP.wild) counts.wild++;
    else if (p === PREP.flat) counts.flat++;
    else if (p === PREP.prepared) counts.prepared++;
    else if (p === PREP.irrigated) counts.irrigated++;
    else if (p === PREP.living) counts.living++;
    else counts.other++;
  }
  return counts;
}

function collectCoordsToInspect(
  jobByCoord: ReadonlyMap<string, OverlayJobEntry>,
  tileLayers: GameView['tiles'],
  idx: ReturnType<typeof hexIndex> | null,
  mode: TileOverlayMode,
): Array<{ q: number; r: number; tileIdx?: number }> {
  const coordsToInspect: Array<{ q: number; r: number; tileIdx?: number }> = [...jobByCoord.values()].map((j) => ({
    q: j.q,
    r: j.r,
  }));
  const seenCoords = new Set(coordsToInspect.map((c) => `${c.q},${c.r}`));
  if (!tileLayers?.prep) return coordsToInspect;
  for (let i = 0; i < tileLayers.count && coordsToInspect.length < MAX_OVERLAY_CHIPS; i++) {
    const p = tileLayers.prep[i];
    if (p !== PREP.living && !(mode === 'living' && p === PREP.irrigated)) continue;
    const q = idx ? idx.q[i]! : i;
    const r = idx ? idx.r[i]! : 0;
    const key = `${q},${r}`;
    if (seenCoords.has(key)) continue;
    seenCoords.add(key);
    coordsToInspect.push({ q, r, tileIdx: i });
  }
  return coordsToInspect;
}

function buildOverlayTileEntries(
  coordsToInspect: ReadonlyArray<{ q: number; r: number; tileIdx?: number }>,
  tileLayers: GameView['tiles'],
  idx: ReturnType<typeof hexIndex> | null,
  jobByCoord: ReadonlyMap<string, OverlayJobEntry>,
): OverlayTileEntry[] {
  const tiles: OverlayTileEntry[] = [];
  for (const c of coordsToInspect) {
    const tileIdx = c.tileIdx ?? (idx ? idx.indexOf(c.q, c.r) : -1);
    const prepCode = tileLayers && tileIdx >= 0 ? tileLayers.prep[tileIdx] : PREP.wild;
    const terrainCode = tileLayers && tileIdx >= 0 ? tileLayers.terrain[tileIdx] : TERRAIN.flat;
    const state = prepCodeToName(prepCode);
    const job = jobByCoord.get(`${c.q},${c.r}`);
    const doneProgress = state === 'prepared' || state === 'flat' || state === 'irrigated' || state === 'living' ? 1 : 0;
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
  return tiles;
}

export function computeOverlayState(
  view: GameView | null | undefined,
  visible: boolean,
  colonyId: number,
  mode: TileOverlayMode = 'all',
): TileOverlayState {
  const tileLayers = view?.tiles;
  const counts = countTilePreps(tileLayers);
  const rawOrders = overlayOrders(view, colonyId);
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

  const radius = view?.planet?.radius;
  const idx = typeof radius === 'number' ? hexIndex(radius) : null;
  const coordsToInspect = collectCoordsToInspect(jobByCoord, tileLayers, idx, mode);
  const tiles = buildOverlayTileEntries(coordsToInspect, tileLayers, idx, jobByCoord);

  const progress = activeOrder
    ? Math.max(activeOrder.currentJob?.progress ?? 0, activeOrder.overallProgress)
    : 0;
  return {
    visible,
    mode,
    livingHint: LIVING_MOVE_SPEED_HINT,
    counts,
    activeOrder,
    orders,
    jobs,
    tiles,
    progress,
    percent: Math.round(progress * 100),
  };
}

/** The colony's first order with work left (what CANCEL and the status line act on). */
export function activeOrderOf(view: GameView | null | undefined, colonyId: number): OverlayOrderProgress | null {
  const first = overlayOrders(view, colonyId)[0];
  return first ? buildOrderProgress(first).summary : null;
}
