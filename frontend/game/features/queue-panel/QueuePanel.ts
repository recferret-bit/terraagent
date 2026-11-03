import {
  cancelQueueTask,
  enqueueQueueTask,
  getColonyQueue,
  reorderQueueTask,
  type EnqueueQueueTaskOptions,
  type PlanetState,
  type QueueEntry,
  type QueueLane,
} from '@terra/sim';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';

const TASK_TITLES: Readonly<Record<string, string>> = {
  solar: 'Solar Array T1',
  metalsExtractor: 'Metals Extractor T1',
  commandHub: 'Command Hub T1',
  harvester: 'Harvester',
};

const TASK_ICONS: Readonly<Record<string, string>> = {
  solar: '☀',
  metalsExtractor: '⛏',
  commandHub: '⬡',
  harvester: '⚙',
};

function resolveChipTitleAndIcon(entry: QueueEntry): { title: string; icon: string } {
  if (entry.task.kind === 'build') {
    const key = entry.task.building;
    return { title: TASK_TITLES[key] ?? key, icon: TASK_ICONS[key] ?? '▣' };
  }
  if (entry.task.kind === 'buildUnit') {
    const key = entry.task.unit;
    return { title: TASK_TITLES[key] ?? key, icon: TASK_ICONS[key] ?? '⚙' };
  }
  return { title: `Terraform: ${entry.task.op}`, icon: '⛰' };
}

function formatChipStatus(entry: QueueEntry): string {
  if (entry.state === 'in_progress') {
    return `in_progress · ${Math.round((entry.progress ?? 0) * 100)}%`;
  }
  if (entry.state === 'waiting') {
    return entry.waitDetail ?? `waiting: ${entry.waitReason ?? 'resources'}`;
  }
  return entry.state;
}

/** Greyed hint on a `waiting(storage)` entry: the cost exceeds a family cap; only a Supply Depot (W03) raises it. */
export const STORAGE_HINT_TEXT = 'Build a Supply Depot to raise the cap (W03)';

/** Adds / removes the greyed storage hint of `chip` to match `entry` (create and in-place update share it). */
function syncStorageHint(chip: HTMLElement, entry: QueueEntry): void {
  const want = entry.state === 'waiting' && entry.waitReason === 'storage';
  const hint = chip.querySelector('[data-testid="queue-storage-hint"]');
  if (want && !hint) {
    const el = document.createElement('div');
    el.className = 'ta-queue-chip__hint';
    el.setAttribute('data-testid', 'queue-storage-hint');
    el.setAttribute('aria-disabled', 'true');
    el.title = 'The Supply Depot arrives in W03';
    el.textContent = STORAGE_HINT_TEXT;
    chip.appendChild(el);
  } else if (!want && hint) {
    hint.remove();
  }
}

function serializeLaneKey(entries: readonly QueueEntry[]): string {
  return entries
    .map((e) => `${e.taskId}:${e.state}:${Math.round((e.progress ?? 0) * 100)}:${e.waitDetail ?? ''}:${e.waitReason ?? ''}`)
    .join('|');
}

function serializeStructureKey(entries: readonly QueueEntry[]): string {
  return entries.map((e) => `${e.taskId}:${e.state}`).join('|');
}

export class QueuePanel {
  readonly root: HTMLElement;
  private readonly ctx: FeatureContext;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly cancelAllBtn: HTMLButtonElement;
  private readonly constructionList: HTMLElement;
  private readonly unitsList: HTMLElement;
  private readonly laneKeys = new Map<HTMLElement, string>();
  private readonly laneStructKeys = new Map<HTMLElement, string>();
  private collapsed = false;
  private entries: QueueEntry[] = [];
  private simState: PlanetState | null = null;
  private colonyIndex = 0;
  private draggedTaskId: string | null = null;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(host: HTMLElement, ctx: FeatureContext) {
    this.ctx = ctx;
    this.root = document.createElement('section');
    this.root.className = 'ta-queue-panel plate-sm';
    this.root.dataset.collapsed = 'false';
    this.root.dataset.empty = 'true';

    const header = document.createElement('div');
    header.className = 'ta-queue-panel__header';

    const title = document.createElement('span');
    title.className = 'ta-queue-panel__title';
    title.textContent = 'QUEUE [Q]';

    this.cancelAllBtn = document.createElement('button');
    this.cancelAllBtn.type = 'button';
    this.cancelAllBtn.className = 'ta-queue-panel__cancel-all-btn';
    this.cancelAllBtn.dataset.testid = 'queue-cancel-all';
    this.cancelAllBtn.setAttribute('data-testid', 'queue-cancel-all');
    this.cancelAllBtn.textContent = 'CANCEL ALL (50% REFUND)';
    this.cancelAllBtn.hidden = true;
    this.cancelAllBtn.onclick = () => this.cancelAll();

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'ta-queue-panel__collapse-btn';
    this.collapseBtn.dataset.queueCollapse = 'true';
    this.collapseBtn.textContent = 'Collapse';
    this.collapseBtn.onclick = () => this.setCollapsed(!this.collapsed);

    header.append(title, this.cancelAllBtn, this.collapseBtn);

    const lanes = document.createElement('div');
    lanes.className = 'ta-queue-panel__lanes';

    const cLane = this.createLaneSection('construction', 'Construction');
    this.constructionList = cLane.list;
    const uLane = this.createLaneSection('units', 'Units');
    this.unitsList = uLane.list;

    lanes.append(cLane.section, uLane.section);
    this.root.append(header, lanes);
    host.appendChild(this.root);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'q' || e.key === 'Q') {
        this.setCollapsed(!this.collapsed);
      }
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onKeyDown);
    }
    this.render();
  }

  private createLaneSection(lane: QueueLane, label: string): { section: HTMLElement; list: HTMLElement } {
    const section = document.createElement('div');
    section.className = 'ta-queue-lane';
    section.dataset.lane = lane;
    section.dataset.empty = 'true';

    const hdr = document.createElement('div');
    hdr.className = 'ta-queue-lane__header';
    hdr.textContent = label;

    const list = document.createElement('div');
    list.className = 'ta-queue-lane__list';
    section.append(hdr, list);
    return { section, list };
  }

  bindSimState(state: PlanetState, colonyIndex = 0): void {
    this.simState = state;
    this.colonyIndex = colonyIndex;
    this.syncFromSimState();
  }

  enqueue(opts: EnqueueQueueTaskOptions): QueueEntry | null {
    if (!this.simState) return null;
    const res = enqueueQueueTask(this.simState, { ...opts, colonyIndex: opts.colonyIndex ?? this.colonyIndex });
    this.syncFromSimState();
    return res.ok ? res.entry : null;
  }

  syncFromSimState(): void {
    if (!this.simState) return;
    this.entries = getColonyQueue(this.simState, this.colonyIndex);
    this.render();
  }

  setEntries(entries: QueueEntry[]): void {
    this.entries = [...entries];
    this.render();
  }

  getEntries(lane?: QueueLane): QueueEntry[] {
    return lane ? this.entries.filter((e) => e.lane === lane) : [...this.entries];
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.root.dataset.collapsed = String(collapsed);
    this.updateHeaderSummary();
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  cancelTask(taskId: string): void {
    if (this.simState) {
      cancelQueueTask(this.simState, taskId, this.colonyIndex);
      this.syncFromSimState();
    } else {
      this.entries = this.entries.filter((e) => e.taskId !== taskId);
      this.render();
    }
    this.ctx.services.sendCommand?.('cancelTask', { taskId });
    this.ctx.services.cancelQueueTask?.(taskId);
  }

  cancelAll(): void {
    if (this.simState) {
      cancelQueueTask(this.simState, 'all', this.colonyIndex);
      this.syncFromSimState();
    } else {
      this.entries = [];
      this.render();
    }
    this.ctx.services.sendCommand?.('cancelTask', { taskId: 'all' });
    this.ctx.services.cancelQueueTask?.('all');
  }

  reorderTask(taskId: string, toIndex: number): void {
    if (this.simState) {
      reorderQueueTask(this.simState, taskId, { toIndex, colonyIndex: this.colonyIndex });
      this.syncFromSimState();
    } else {
      const idx = this.entries.findIndex((e) => e.taskId === taskId);
      if (idx >= 0) {
        const target = this.entries[idx];
        const laneIndices = this.entries
          .map((e, i) => (e.lane === target.lane ? i : -1))
          .filter((i) => i >= 0);
        const pos = laneIndices.indexOf(idx);
        const clamped = Math.max(0, Math.min(laneIndices.length - 1, toIndex));
        if (pos >= 0 && clamped !== pos) {
          const laneItems = laneIndices.map((i) => this.entries[i]);
          const [moved] = laneItems.splice(pos, 1);
          laneItems.splice(clamped, 0, moved);
          for (let k = 0; k < laneIndices.length; k++) {
            this.entries[laneIndices[k]] = laneItems[k];
          }
          this.render();
        }
      }
    }
    this.ctx.services.sendCommand?.('reorderTask', { taskId, toIndex });
  }

  update(view: GameView): void {
    if (this.simState) {
      this.syncFromSimState();
      return;
    }
    this.colonyIndex = ownColonyIndex(this.ctx.services); // the player's seat (FF-05), not colony 0
    const colonies = view.colonies as Array<{ index?: number; queue?: QueueEntry[]; constructionQueue?: QueueEntry[]; unitQueue?: QueueEntry[] }> | undefined;
    const col = colonies?.find((c) => c.index === this.colonyIndex) ?? colonies?.[this.colonyIndex] ?? {};
    const blobEntries = (view.blobs?.queue as { value?: { entries?: QueueEntry[] }; entries?: QueueEntry[] } | undefined);
    const fromBlob = blobEntries?.value?.entries ?? blobEntries?.entries;
    if (Array.isArray(col.queue)) {
      this.entries = col.queue;
    } else if (Array.isArray(fromBlob)) {
      this.entries = fromBlob.filter((e) => (e.colonyIndex ?? 0) === this.colonyIndex);
    } else if (Array.isArray(col.constructionQueue) || Array.isArray(col.unitQueue)) {
      this.entries = [...(col.constructionQueue ?? []), ...(col.unitQueue ?? [])];
    }
    this.render();
  }

  private updateHeaderSummary(): void {
    const count = this.entries.length;
    this.collapseBtn.textContent = this.collapsed ? `+${count} more` : 'Collapse';
    this.cancelAllBtn.hidden = count === 0;
  }

  private render(): void {
    this.root.dataset.empty = String(this.entries.length === 0);
    this.updateHeaderSummary();
    this.renderLane(this.constructionList, this.entries.filter((e) => e.lane === 'construction' || e.lane === 'terraform'));
    this.renderLane(this.unitsList, this.entries.filter((e) => e.lane === 'units'));
  }

  private renderLane(container: HTMLElement, laneEntries: QueueEntry[]): void {
    if (container.parentElement) {
      container.parentElement.dataset.empty = String(laneEntries.length === 0);
    }
    const nextFullKey = serializeLaneKey(laneEntries);
    if (this.laneKeys.get(container) === nextFullKey) return;
    this.laneKeys.set(container, nextFullKey);

    const nextStructKey = serializeStructureKey(laneEntries);
    if (this.laneStructKeys.get(container) === nextStructKey && container.children.length === laneEntries.length) {
      for (let i = 0; i < laneEntries.length; i++) {
        this.updateChipInPlace(container.children[i] as HTMLElement, laneEntries[i]);
      }
      return;
    }

    this.laneStructKeys.set(container, nextStructKey);
    container.innerHTML = '';
    laneEntries.forEach((entry, index) => {
      container.appendChild(this.createChipElement(entry, index, laneEntries.length));
    });
  }

  private updateChipInPlace(chip: HTMLElement, entry: QueueEntry): void {
    chip.dataset.state = entry.state;
    const status = chip.querySelector('[data-chip-status]') as HTMLElement | null;
    if (status) {
      status.dataset.chipStatus = entry.state;
      status.textContent = formatChipStatus(entry);
    }
    const fill = chip.querySelector('.ta-queue-chip__bar-fill') as HTMLElement | null;
    if (fill && entry.state === 'in_progress') {
      const pct = Math.round((entry.progress ?? 0) * 100);
      fill.dataset.chipProgress = String(pct);
      fill.style.width = `${pct}%`;
    }
    syncStorageHint(chip, entry);
  }

  private createChipElement(entry: QueueEntry, index: number, total: number): HTMLElement {
    const chip = document.createElement('div');
    chip.className = 'ta-queue-chip';
    chip.dataset.taskId = entry.taskId;
    chip.dataset.state = entry.state;
    chip.draggable = true;

    chip.ondragstart = () => {
      this.draggedTaskId = entry.taskId;
    };
    chip.ondragover = (e) => e.preventDefault?.();
    chip.ondrop = (e) => {
      e.preventDefault?.();
      if (this.draggedTaskId && this.draggedTaskId !== entry.taskId) {
        this.reorderTask(this.draggedTaskId, index);
      }
      this.draggedTaskId = null;
    };

    const { title, icon } = resolveChipTitleAndIcon(entry);
    const row = document.createElement('div');
    row.className = 'ta-queue-chip__row';

    const info = document.createElement('div');
    info.className = 'ta-queue-chip__info';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'ta-queue-chip__icon';
    iconSpan.dataset.chipIcon = icon;
    iconSpan.textContent = icon;
    const titleSpan = document.createElement('span');
    titleSpan.dataset.chipTitle = title;
    titleSpan.textContent = title;
    info.append(iconSpan, titleSpan);

    const actions = this.createChipActions(entry, index, total);
    row.append(info, actions);

    const status = document.createElement('div');
    status.className = 'ta-queue-chip__status';
    status.dataset.chipStatus = entry.state;
    status.textContent = formatChipStatus(entry);

    chip.append(row, status);
    syncStorageHint(chip, entry);

    if (entry.state === 'in_progress') {
      const bar = document.createElement('div');
      bar.className = 'ta-queue-chip__bar';
      const fill = document.createElement('div');
      fill.className = 'ta-queue-chip__bar-fill';
      fill.dataset.chipProgress = String(Math.round((entry.progress ?? 0) * 100));
      fill.style.width = `${Math.round((entry.progress ?? 0) * 100)}%`;
      bar.appendChild(fill);
      chip.appendChild(bar);
    }

    return chip;
  }

  private createChipActions(entry: QueueEntry, index: number, total: number): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'ta-queue-chip__actions';

    if (index > 0) {
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'ta-queue-chip__btn';
      upBtn.dataset.reorderUp = entry.taskId;
      upBtn.textContent = '↑';
      upBtn.onclick = () => this.reorderTask(entry.taskId, index - 1);
      actions.appendChild(upBtn);
    }

    if (index < total - 1) {
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'ta-queue-chip__btn';
      downBtn.dataset.reorderDown = entry.taskId;
      downBtn.textContent = '↓';
      downBtn.onclick = () => this.reorderTask(entry.taskId, index + 1);
      actions.appendChild(downBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ta-queue-chip__btn ta-queue-chip__btn--cancel';
    cancelBtn.dataset.cancelTask = entry.taskId;
    cancelBtn.textContent = '×';
    cancelBtn.onclick = () => this.cancelTask(entry.taskId);
    actions.appendChild(cancelBtn);

    return actions;
  }

  dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.laneKeys.clear();
    this.laneStructKeys.clear();
    this.root.remove();
  }
}
