import type { QueueEntry } from '@terra/sim';
import type { FeatureContext } from '../../core/registry/types';

export const TASK_TITLES: Readonly<Record<string, string>> = {
  solar: 'Solar Array T1',
  metalsExtractor: 'Metals Extractor T1',
  commandHub: 'Command Hub T1',
  harvester: 'Harvester',
  pylon: 'Power Line Pylon T1',
  capacitor: 'Capacitor Bank T1',
  wind: 'Wind Turbine T1',
  thermal: 'Thermal Plant T1',
  supplyDepot: 'Supply Depot T1',
  mineralsQuarry: 'Minerals Quarry T1',
  waterExtractor: 'Water Extractor T1',
  petroleumWell: 'Petroleum Well T1',
  builder: 'Builder Drone',
};

export const TASK_ICONS: Readonly<Record<string, string>> = {
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
  if (task.kind === 'powerLine') {
    const count = Array.isArray(task.tiles) ? task.tiles.length : 1;
    return { title: `Power Line (${count}× Pylon)`, icon: '⚡' };
  }
  if (task.kind === 'repair') {
    return { title: `Repair #${task.entityId}`, icon: '🔧' };
  }
  if (task.kind === 'hqGoal') {
    return { title: `Goal: ${task.goal}`, icon: '🎯' };
  }
  return { title: `Terraform: ${task.op}`, icon: '⛰' };
}

export function formatChipStatus(entry: QueueEntry): string {
  if (entry.state === 'in_progress') {
    return `in_progress · ${Math.round((entry.progress ?? 0) * 100)}%`;
  }
  if (entry.state === 'waiting') {
    return entry.waitDetail ?? `waiting: ${entry.waitReason ?? 'resources'}`;
  }
  return entry.state;
}

/** Greyed hint on a `waiting(storage)` entry in W02 (`..02`): the cost exceeds a family cap; Supply Depot arrives in W03. */
export const STORAGE_HINT_TEXT = 'Build a Supply Depot to raise the cap (W03)';

/** Clickable button text on a `waiting(storage)` entry in W03+: opens the Supply Depot placement ghost. */
export const STORAGE_HINT_BUTTON_TEXT = 'Build Supply Depot';

/** Adds / removes the storage hint or "Build Depot" button of `chip` to match `entry`. */
export function syncStorageHint(chip: HTMLElement, entry: QueueEntry, ctx: FeatureContext): void {
  const want = entry.state === 'waiting' && entry.waitReason === 'storage';
  const hint = chip.querySelector('[data-testid="queue-storage-hint"]');
  const hasW03 = hasFlag(ctx.flags, 'W03');
  if (want && !hint) {
    if (hasW03) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-queue-chip__hint ta-queue-chip__hint--btn btn-sm';
      btn.setAttribute('data-testid', 'queue-storage-hint');
      btn.dataset.buildDepot = 'true';
      btn.title = 'Open Supply Depot placement ghost (+1 000 storage cap)';
      btn.textContent = STORAGE_HINT_BUTTON_TEXT;
      btn.onclick = (e) => {
        e.stopPropagation();
        ctx.services.startPlacement?.('supplyDepot');
      };
      chip.appendChild(btn);
    } else {
      const el = document.createElement('div');
      el.className = 'ta-queue-chip__hint';
      el.setAttribute('data-testid', 'queue-storage-hint');
      el.setAttribute('aria-disabled', 'true');
      el.title = 'The Supply Depot arrives in W03';
      el.textContent = STORAGE_HINT_TEXT;
      chip.appendChild(el);
    }
  } else if (!want && hint) {
    hint.remove();
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
