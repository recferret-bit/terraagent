import { terraformOrdersOf, type QueueEntry, type QueueLane } from '@terra/sim';
import type { FeatureContext, GameView } from '../../core/registry/types';

export const TASK_TITLES: Readonly<Record<string, string>> = {
  tradeHub: 'Inter-Colony Trade Hub T1',
  solar: 'Solar Array T1',
  metalsExtractor: 'Resource Extractor T1',
  commandHub: 'Command Hub T1',
  pylon: 'Power Pylon T1',
  capacitor: 'Capacitor Bank T1',
  wind: 'Wind Turbine T1',
  thermal: 'Thermal Plant T1',
  supplyDepot: 'Supply Depot T1',
  mineralsQuarry: 'Minerals Quarry T1',
  waterExtractor: 'Water Extractor T1',
  petroleumWell: 'Petroleum Well T1',
};

export const TASK_ICONS: Readonly<Record<string, string>> = {
  tradeHub: '⇵',
  solar: '☀',
  metalsExtractor: '⛏',
  commandHub: '⬡',
  pylon: '⚡',
  capacitor: '🔋',
  wind: '🌀',
  thermal: '🔥',
  supplyDepot: '📦',
  mineralsQuarry: '⛏',
  waterExtractor: '💧',
  petroleumWell: '🛢',
};

const RESOURCE_LABELS: Readonly<Record<string, string>> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
  'chem.oil': 'Oil',
};

function formatEarmarkResource(res: string): string {
  if (RESOURCE_LABELS[res]) return RESOURCE_LABELS[res];
  const parts = res.split('.');
  const last = parts[parts.length - 1] ?? res;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export function hasFlag(flags: FeatureContext['flags'] | undefined, flag: string): boolean {
  if (!flags) return false;
  if (typeof (flags as { has?: unknown }).has === 'function') {
    return (flags as { has(w: string): boolean }).has(flag);
  }
  return false;
}

const WORKER_TIER_ICON = ['', '⚙', '🔧', '🚜'] as const;

function buildUnitChip(task: { unit: string; tier?: number }): { title: string; icon: string } {
  const tier = task.tier === 2 || task.tier === 3 ? task.tier : 1;
  if (task.unit === 'worker') return { title: `Worker Drone T${tier}`, icon: WORKER_TIER_ICON[tier] };
  return { title: TASK_TITLES[task.unit] ?? task.unit, icon: TASK_ICONS[task.unit] ?? '⚙' };
}

export function resolveChipTitleAndIcon(entry: QueueEntry): { title: string; icon: string } {
  const task = entry.task;
  if (task.kind === 'build') {
    const key = task.building;
    return { title: TASK_TITLES[key] ?? key, icon: TASK_ICONS[key] ?? '▣' };
  }
  if (task.kind === 'buildUnit') return buildUnitChip(task);
  if (task.kind === 'repair') {
    return { title: `Repair #${task.entityId}`, icon: '🔧' };
  }
  if (task.kind === 'hqGoal') {
    return { title: `Goal: ${task.goal}`, icon: '🎯' };
  }
  if (task.kind === 'dismantle') {
    const name = task.building ? (TASK_TITLES[task.building] ?? task.building) : `#${task.entityId}`;
    return { title: `Dismantle ${name}`, icon: '⛏' };
  }
  if (task.kind === 'project') {
    return { title: `Project: ${task.project.replace(/^project\./, '').replace(/_/g, ' ')}`, icon: '★' };
  }
  return { title: `Terraform: ${task.op}`, icon: '⛰' };
}

export function formatChipStatus(entry: QueueEntry): string {
  // A dismantle comes down step by step: "Dismantling n%" once a worker is on it (owner feedback W03 #6).
  if (entry.task.kind === 'dismantle' && entry.state === 'in_progress') {
    return entry.waitReason ? (entry.waitDetail ?? `waiting: ${entry.waitReason}`) : `Dismantling ${Math.round((entry.progress ?? 0) * 100)}%`;
  }
  if (entry.state === 'in_progress') {
    if (entry.waitReason === 'site' && entry.waitDetail) {
      const m = /^waiting: site \(prep (\d+\/\d+)\)$/.exec(entry.waitDetail);
      return m ? `waiting(site: ${m[1]} tiles prepared)` : entry.waitDetail;
    }
    return `in_progress · ${Math.round((entry.progress ?? 0) * 100)}%`;
  }
  if (entry.state === 'waiting') {
    if (entry.waitReason === 'site' && entry.waitDetail) {
      const m = /^waiting: site \(prep (\d+\/\d+)\)$/.exec(entry.waitDetail);
      if (m) return `waiting(site: ${m[1]} tiles prepared)`;
    }
    return entry.waitDetail ?? `waiting: ${entry.waitReason ?? 'resources'}`;
  }
  return entry.state;
}

/** Greyed hint on a `waiting(storage)` entry in W02 (`..02`): the cost exceeds a family cap; Supply Depot arrives in W03. */
export const STORAGE_HINT_TEXT = 'Build a Supply Depot to raise the cap (W03)';

/** Clickable button text on a `waiting(storage)` entry in W03+: opens the Supply Depot placement ghost. */
export const STORAGE_HINT_BUTTON_TEXT = 'Build Supply Depot';

/** Greyed hint on a `waiting: supply` unit order in W02: the unit supply cap is reached; the Supply Depot is W03. */
export const SUPPLY_HINT_TEXT = 'Supply cap reached: lose a unit to free supply (Supply Depot in W03)';

/** The two waits a Supply Depot resolves: a family storage cap, and the unit supply cap. */
const DEPOT_HINTS: Readonly<Record<'storage' | 'supply', { testid: string; title: string; greyed: string; greyedTitle: string }>> = {
  storage: {
    testid: 'queue-storage-hint',
    title: 'Open Supply Depot placement ghost (+1 000 storage cap)',
    greyed: STORAGE_HINT_TEXT,
    greyedTitle: 'The Supply Depot arrives in W03',
  },
  supply: {
    testid: 'queue-supply-hint',
    title: 'Supply cap reached: open Supply Depot placement ghost (+8 unit supply)',
    greyed: SUPPLY_HINT_TEXT,
    greyedTitle: 'The Supply Depot arrives in W03',
  },
};

function depotHintElement(kind: 'storage' | 'supply', ctx: FeatureContext): HTMLElement {
  const def = DEPOT_HINTS[kind];
  if (!hasFlag(ctx.flags, 'W03')) {
    const el = document.createElement('div');
    el.className = 'ta-queue-chip__hint';
    el.setAttribute('data-testid', def.testid);
    el.setAttribute('aria-disabled', 'true');
    el.title = def.greyedTitle;
    el.textContent = def.greyed;
    return el;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ta-queue-chip__hint ta-queue-chip__hint--btn btn-sm';
  btn.setAttribute('data-testid', def.testid);
  btn.dataset.buildDepot = 'true';
  btn.title = def.title;
  btn.textContent = STORAGE_HINT_BUTTON_TEXT;
  btn.onclick = (e) => {
    e.stopPropagation();
    ctx.services.startPlacement?.('supplyDepot');
  };
  return btn;
}

/**
 * Adds / removes the "Build Supply Depot" button (W03) or greyed hint (W02) of `chip` to match `entry`: shown while
 * the entry waits on `storage` (a family cap) or `supply` (the unit supply cap).
 */
export function syncStorageHint(chip: HTMLElement, entry: QueueEntry, ctx: FeatureContext): void {
  const want = entry.state === 'waiting' && (entry.waitReason === 'storage' || entry.waitReason === 'supply') ? entry.waitReason : null;
  for (const kind of ['storage', 'supply'] as const) {
    const hint = chip.querySelector(`[data-testid="${DEPOT_HINTS[kind].testid}"]`);
    if (want === kind && !hint) chip.appendChild(depotHintElement(kind, ctx));
    else if (want !== kind && hint) hint.remove();
  }
}

function formatEarmarkSummary(earmarked: Partial<Record<string, number>> | undefined): {
  summary: string;
  totalEarmarked: number;
} | null {
  if (!earmarked) return null;
  const parts: string[] = [];
  let totalEarmarked = 0;
  for (const [res, amt] of Object.entries(earmarked)) {
    const n = Number(amt ?? 0);
    if (n > 0) {
      totalEarmarked += n;
      parts.push(`${Math.round(n)} ${formatEarmarkResource(res)}`);
    }
  }
  if (parts.length === 0) return null;
  return { summary: `Earmarked: ${parts.join(' · ')}`, totalEarmarked };
}

/** Adds / updates / removes the earmark bar of `chip` when `entry.earmarked` has reserved missing resources. */
export function syncEarmarkBar(chip: HTMLElement, entry: QueueEntry): void {
  const info = formatEarmarkSummary(entry.earmarked);
  const existing = chip.querySelector('[data-testid="queue-earmark-bar"]') as HTMLElement | null;
  if (info && !existing) {
    const wrap = document.createElement('div');
    wrap.className = 'ta-queue-chip__earmark';
    wrap.setAttribute('data-testid', 'queue-earmark-bar');
    const label = document.createElement('span');
    label.className = 'ta-queue-chip__earmark-label';
    label.textContent = info.summary;
    const bar = document.createElement('div');
    bar.className = 'ta-queue-chip__earmark-track';
    const fill = document.createElement('div');
    fill.className = 'ta-queue-chip__earmark-fill';
    fill.style.width = '100%';
    bar.appendChild(fill);
    wrap.append(label, bar);
    chip.appendChild(wrap);
  } else if (info && existing) {
    const label = existing.querySelector('.ta-queue-chip__earmark-label');
    if (label) label.textContent = info.summary;
  } else if (!info && existing) {
    existing.remove();
  }
}

export function serializeLaneKey(entries: readonly QueueEntry[]): string {
  return entries
    .map((e) => {
      const em = e.earmarked ? Object.entries(e.earmarked).map(([k, v]) => `${k}=${v}`).join(',') : '';
      return `${e.taskId}:${e.state}:${Math.round((e.progress ?? 0) * 100)}:${e.waitDetail ?? ''}:${e.waitReason ?? ''}:${em}`;
    })
    .join('|');
}

export function serializeStructureKey(entries: readonly QueueEntry[]): string {
  return entries.map((e) => `${e.taskId}:${e.state}`).join('|');
}

/** The kind a same-kind cancel groups by (all terraform work is one kind; builds group by building, units by unit). */
export const chipKind = (e: QueueEntry): string => {
  if (e.task.kind === 'build') return `build:${e.task.building}`;
  if (e.task.kind === 'buildUnit') {
    const tier = (e.task as { tier?: number }).tier;
    return `buildUnit:${e.task.unit}:${tier === 2 || tier === 3 ? tier : 1}`;
  }
  return e.task.kind;
};

export const LANE_TABS: ReadonlyArray<{ id: QueueLane | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'construction', label: 'Construction' },
  { id: 'terraform', label: 'Terraform' },
  { id: 'units', label: 'Units' },
  { id: 'hqGoals', label: 'HQ Goals' },
];

export function reorderEntryInLane(entries: QueueEntry[], taskId: string, toIndex: number): boolean {
  const idx = entries.findIndex((e) => e.taskId === taskId);
  if (idx < 0) return false;
  const target = entries[idx]!;
  const laneIndices = entries.map((e, i) => (e.lane === target.lane ? i : -1)).filter((i) => i >= 0);
  const pos = laneIndices.indexOf(idx);
  const clamped = Math.max(0, Math.min(laneIndices.length - 1, toIndex));
  if (pos < 0 || clamped === pos) return false;
  const laneItems = laneIndices.map((i) => entries[i]!);
  const [moved] = laneItems.splice(pos, 1);
  laneItems.splice(clamped, 0, moved!);
  for (let k = 0; k < laneIndices.length; k++) {
    entries[laneIndices[k]!] = laneItems[k]!;
  }
  return true;
}

export function extractQueueEntriesFromView(view: GameView, colonyIndex: number): QueueEntry[] {
  const colonies = view.colonies as Array<{ index?: number; queue?: QueueEntry[]; constructionQueue?: QueueEntry[]; unitQueue?: QueueEntry[] }> | undefined;
  const col = colonies?.find((c) => c.index === colonyIndex) ?? colonies?.[colonyIndex] ?? {};
  const blobEntries = (view.blobs?.queue as { value?: { entries?: QueueEntry[] }; entries?: QueueEntry[] } | undefined);
  const fromBlob = blobEntries?.value?.entries ?? blobEntries?.entries;
  let entries: QueueEntry[] = [];
  if (Array.isArray(col.queue)) {
    entries = [...col.queue];
  } else if (Array.isArray(fromBlob)) {
    entries = fromBlob.filter((e) => (e.colonyIndex ?? 0) === colonyIndex);
  } else if (Array.isArray(col.constructionQueue) || Array.isArray(col.unitQueue)) {
    entries = [...(col.constructionQueue ?? []), ...(col.unitQueue ?? [])];
  }
  const tfBlob = (view.blobs?.terraformTasks as { value?: unknown } | undefined)?.value ?? view.blobs?.terraformTasks;
  const tfOrders = terraformOrdersOf(tfBlob, colonyIndex);
  for (const o of tfOrders) {
    const waitReason = o.waitReason ?? o.jobs[0]?.waitReason;
    const isWaiting = o.status === 'waiting' || o.jobs[0]?.status === 'waiting' || Boolean(waitReason);
    const total = Math.max(o.jobs.length, o.totalJobs ?? o.jobs.length);
    const done = o.completedJobs ?? Math.max(0, total - o.jobs.length);
    const progress = total > 0 ? Math.min(1, (done + Number(o.jobs[0]?.progress ?? 0)) / total) : 0;
    const patch = { state: (isWaiting ? 'waiting' : 'in_progress') as QueueEntry['state'], waitReason, waitDetail: waitReason ? `waiting(${waitReason})` : undefined, progress };
    const idx = entries.findIndex((e) => e.taskId === o.orderId || e.taskId === o.taskId);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx]!, ...patch };
      continue;
    }
    entries.push({
      taskId: o.orderId, colonyIndex, lane: 'terraform', precedence: o.isLinkedPrep ? 'system' : 'player',
      ...patch, task: { kind: 'terraform', op: o.op, q: o.jobs[0]?.q ?? 0, r: o.jobs[0]?.r ?? 0 },
      cost: {}, paid: true, buildTicks: Math.max(1, total * 50), elapsedTicks: Math.round(progress * total * 50), workRate: 1, createdAt: 0,
    });
  }
  return entries;
}
