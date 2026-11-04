import {
  cancelQueueTask,
  enqueueQueueTask,
  getColonyQueue,
  reorderQueueTask,
  sameKindTaskIds,
  terraformOrdersOf,
  type EnqueueQueueTaskOptions,
  type PlanetState,
  type QueueEntry,
  type QueueLane,
} from '@terra/sim';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import {
  STORAGE_HINT_BUTTON_TEXT,
  STORAGE_HINT_TEXT,
  formatChipStatus,
  hasFlag,
  resolveChipTitleAndIcon,
  serializeLaneKey,
  serializeStructureKey,
  syncEarmarkBar,
  syncStorageHint,
} from './queueChipHelpers';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';

export { STORAGE_HINT_BUTTON_TEXT, STORAGE_HINT_TEXT };

/** The kind a same-kind cancel groups by (all terraform work is one kind; builds group by building, units by unit). */
const chipKind = (e: QueueEntry): string =>
  e.task.kind === 'build' ? `build:${e.task.building}` : e.task.kind === 'buildUnit' ? `buildUnit:${e.task.unit}` : e.task.kind;

const LANE_TABS: ReadonlyArray<{ id: QueueLane | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'construction', label: 'Construction' },
  { id: 'terraform', label: 'Terraform' },
  { id: 'units', label: 'Units' },
  { id: 'hqGoals', label: 'HQ Goals' },
];

export class QueuePanel {
  readonly root: HTMLElement;
  private readonly ctx: FeatureContext;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly cancelAllBtn: HTMLButtonElement;
  private readonly tabsBar: HTMLElement;
  private readonly constructionList: HTMLElement;
  private readonly terraformList: HTMLElement;
  private readonly unitsList: HTMLElement;
  private readonly hqGoalsList: HTMLElement;
  private readonly laneSections = new Map<QueueLane, HTMLElement>();
  private readonly laneKeys = new Map<HTMLElement, string>();
  private readonly laneStructKeys = new Map<HTMLElement, string>();
  private activeLaneTab: QueueLane | 'all' = 'all';
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
    this.root.dataset.activeLane = 'all';

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
    this.tabsBar = this.createTabsBar();

    const lanes = document.createElement('div');
    lanes.className = 'ta-queue-panel__lanes';

    const cLane = this.createLaneSection('construction', 'Construction');
    this.constructionList = cLane.list;
    const tLane = this.createLaneSection('terraform', 'Terraform');
    this.terraformList = tLane.list;
    const uLane = this.createLaneSection('units', 'Units');
    this.unitsList = uLane.list;
    const gLane = this.createLaneSection('hqGoals', 'HQ Goals');
    this.hqGoalsList = gLane.list;

    lanes.append(cLane.section, tLane.section, uLane.section, gLane.section);
    if (hasFlag(this.ctx.flags, 'W03')) {
      this.root.append(header, this.tabsBar, lanes);
    } else {
      this.root.append(header, lanes);
    }
    host.appendChild(this.root);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isGameInputBlocked()) return;
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

  private createTabsBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'ta-queue-panel__tabs';
    bar.dataset.testid = 'queue-lane-tabs';
    bar.setAttribute('data-testid', 'queue-lane-tabs');
    for (const tab of LANE_TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-queue-panel__tab';
      btn.dataset.laneTab = tab.id;
      btn.dataset.active = String(tab.id === this.activeLaneTab);
      btn.setAttribute('aria-pressed', String(tab.id === this.activeLaneTab));
      btn.textContent = tab.label;
      btn.onclick = () => this.setActiveLane(tab.id);
      bar.appendChild(btn);
    }
    return bar;
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
    this.laneSections.set(lane, section);
    return { section, list };
  }

  setActiveLane(lane: QueueLane | 'all'): void {
    this.activeLaneTab = lane;
    this.root.dataset.activeLane = lane;
    const buttons = this.tabsBar.querySelectorAll<HTMLButtonElement>('[data-lane-tab]');
    for (const btn of buttons) {
      const active = btn.dataset.laneTab === lane;
      btn.dataset.active = String(active);
      btn.setAttribute('aria-pressed', String(active));
    }
    this.syncLaneVisibility();
  }

  getActiveLane(): QueueLane | 'all' {
    return this.activeLaneTab;
  }

  private syncLaneVisibility(): void {
    const hasW03 = hasFlag(this.ctx.flags, 'W03');
    for (const [lane, section] of this.laneSections.entries()) {
      if (!hasW03 && (lane === 'terraform' || lane === 'hqGoals')) {
        section.hidden = true;
      } else {
        section.hidden = this.activeLaneTab !== 'all' && this.activeLaneTab !== lane;
      }
    }
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

  /**
   * The cancel click: ends this entry and every other open order of the same kind (several terraform orders go at once;
   * the host does it in one `cancelTask { scope: 'sameKind' }`, this mirrors it on a local sim state / entry list).
   */
  cancelTask(taskId: string): void {
    if (this.simState) {
      for (const id of sameKindTaskIds(this.simState, taskId, this.colonyIndex)) cancelQueueTask(this.simState, id, this.colonyIndex);
      this.syncFromSimState();
    } else {
      const hit = this.entries.find((e) => e.taskId === taskId);
      const kind = hit ? chipKind(hit) : undefined;
      this.entries = this.entries.filter((e) => e.taskId !== taskId && (kind === undefined || e.goalId !== undefined || chipKind(e) !== kind));
      this.render();
    }
    this.ctx.services.sendCommand?.('cancelTask', { taskId, scope: 'sameKind' });
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
      this.entries = [...col.queue];
    } else if (Array.isArray(fromBlob)) {
      this.entries = fromBlob.filter((e) => (e.colonyIndex ?? 0) === this.colonyIndex);
    } else if (Array.isArray(col.constructionQueue) || Array.isArray(col.unitQueue)) {
      this.entries = [...(col.constructionQueue ?? []), ...(col.unitQueue ?? [])];
    }
    const tfBlob = (view.blobs?.terraformTasks as { value?: unknown } | undefined)?.value ?? view.blobs?.terraformTasks;
    const tfOrders = terraformOrdersOf(tfBlob, this.colonyIndex);
    if (tfOrders.length > 0) {
      for (const o of tfOrders) {
        const waitReason = o.waitReason ?? o.jobs[0]?.waitReason;
        const isWaiting = o.status === 'waiting' || o.jobs[0]?.status === 'waiting' || Boolean(waitReason);
        const total = Math.max(o.jobs.length, o.totalJobs ?? o.jobs.length);
        const done = o.completedJobs ?? Math.max(0, total - o.jobs.length);
        const progress = total > 0 ? Math.min(1, (done + Number(o.jobs[0]?.progress ?? 0)) / total) : 0;
        const patch = { state: (isWaiting ? 'waiting' : 'in_progress') as QueueEntry['state'], waitReason, waitDetail: waitReason ? `waiting(${waitReason})` : undefined, progress };
        const idx = this.entries.findIndex((e) => e.taskId === o.orderId || e.taskId === o.taskId);
        if (idx >= 0) { this.entries[idx] = { ...this.entries[idx]!, ...patch }; continue; }
        this.entries.push({
          taskId: o.orderId, colonyIndex: this.colonyIndex, lane: 'terraform', precedence: o.isLinkedPrep ? 'system' : 'player',
          ...patch, task: { kind: 'terraform', op: o.op, q: o.jobs[0]?.q ?? 0, r: o.jobs[0]?.r ?? 0 },
          cost: {}, paid: true, buildTicks: Math.max(1, total * 50), elapsedTicks: Math.round(progress * total * 50), workRate: 1, createdAt: 0,
        });
      }
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
    const hasW03 = hasFlag(this.ctx.flags, 'W03');
    if (hasW03) {
      this.renderLane(this.constructionList, this.entries.filter((e) => e.lane === 'construction'));
      this.renderLane(this.terraformList, this.entries.filter((e) => e.lane === 'terraform'));
    } else {
      this.renderLane(this.constructionList, this.entries.filter((e) => e.lane === 'construction' || e.lane === 'terraform'));
      this.renderLane(this.terraformList, []);
    }
    this.renderLane(this.unitsList, this.entries.filter((e) => e.lane === 'units'));
    this.renderLane(this.hqGoalsList, this.entries.filter((e) => e.lane === 'hqGoals'));
    this.syncLaneVisibility();
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
    syncStorageHint(chip, entry, this.ctx);
    syncEarmarkBar(chip, entry);
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
    syncStorageHint(chip, entry, this.ctx);
    syncEarmarkBar(chip, entry);

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
