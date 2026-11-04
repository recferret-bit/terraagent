import type { QueueEntry } from '@terra/sim';
import type { FeatureContext } from '../../core/registry/types';

export const TASK_TITLES: Readonly<Record<string, string>> = {
  tradeHub: 'Inter-Colony Trade Hub T1',
  solar: 'Solar Array T1',
  metalsExtractor: 'Resource Extractor T1',
  commandHub: 'Command Hub T1',
  harvester: 'Harvester',
  pylon: 'Power Pylon T1',
  capacitor: 'Capacitor Bank T1',
  wind: 'Wind Turbine T1',
  thermal: 'Thermal Plant T1',
  supplyDepot: 'Supply Depot T1',
  mineralsQuarry: 'Minerals Quarry T1',
  waterExtractor: 'Water Extractor T1',
  petroleumWell: 'Petroleum Well T1',
  builder: 'Builder Drone',
  terraformer: 'Terraformer Drone',
};

export const TASK_ICONS: Readonly<Record<string, string>> = {
  tradeHub: '⇵',
  solar: '☀',
  metalsExtractor: '⛏',
  commandHub: '⬡',
  harvester: '⚙',
  pylon: '⚡',
  capacitor: '🔋',
  wind: '🌀',
  thermal: '🔥',
  supplyDepot: '📦',
  mineralsQuarry: '⛏',
  waterExtractor: '💧',
  petroleumWell: '🛢',
  builder: '🔧',
  terraformer: '🚜',
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

export function resolveChipTitleAndIcon(entry: QueueEntry): { title: string; icon: string } {
  const task = entry.task;
  if (task.kind === 'build') {
    const key = task.building;
    return { title: TASK_TITLES[key] ?? key, icon: TASK_ICONS[key] ?? '▣' };
  }
  if (task.kind === 'buildUnit') {
    const key = task.unit;
    return { title: TASK_TITLES[key] ?? key, icon: TASK_ICONS[key] ?? '⚙' };
  }
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
