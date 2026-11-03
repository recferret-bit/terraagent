import type { GoalKind, GoalParams, QueueGoalArgs } from '@terra/contracts';
import {
  DEFAULT_GOAL_BUDGET_BP,
  GOAL_CATALOG,
  type ColonyGoalEntry,
} from '@terra/sim';
import type { FeatureContext } from '../../core/registry/types';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { renderStageSuggestion } from './suggestion';
import { GoalForm } from './GoalForm';

export function formatGoalLabel(goal: GoalKind, params?: GoalParams): string {
  if (goal === 'grow_economy') {
    const rawRes = params?.resource ?? 'metals.t1';
    const res = rawRes.replace(/\.t[0-9]+$/, '').replace(/^bio\./, '');
    const rate = params?.targetRatePerMin ?? 10;
    return `Grow Economy (${rate} ${res}/min)`;
  }
  if (goal === 'secure_power') {
    const net = params?.targetNetEnergyPerS ?? 10;
    return `Secure Power (+${net} E/s night)`;
  }
  return GOAL_CATALOG[goal]?.label ?? goal;
}

export class GoalsPanel {
  readonly root: HTMLElement;
  private readonly ctx: FeatureContext;
  private readonly limitBadge: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly suggestionContainer: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly form: GoalForm;

  private colonyIndex = 0;
  private goalLimit = 2;
  private colonyStage = 0;
  private suggestionDismissed = false;
  private goals: ColonyGoalEntry[] = [];
  private collapsed = false;
  private draggedGoalId: string | null = null;
  private lastListKey = '';

  constructor(host: HTMLElement, ctx: FeatureContext) {
    this.ctx = ctx;
    this.colonyIndex = ownColonyIndex(ctx.services);

    this.root = document.createElement('section');
    this.root.className = 'ta-goals-panel plate-sm';
    this.root.setAttribute('data-testid', 'goals-panel');
    this.root.dataset.collapsed = 'false';

    const header = document.createElement('div');
    header.className = 'ta-goals-panel__header';

    const title = document.createElement('span');
    title.className = 'ta-goals-panel__title';
    title.textContent = 'HQ GOALS';

    this.limitBadge = document.createElement('span');
    this.limitBadge.className = 'ta-goals-panel__limit-badge';
    this.limitBadge.setAttribute('data-testid', 'goals-limit-badge');
    this.limitBadge.textContent = '0 / 2';

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'ta-goals-panel__collapse-btn';
    this.collapseBtn.setAttribute('data-testid', 'goals-collapse-btn');
    this.collapseBtn.textContent = 'COLLAPSE';
    this.collapseBtn.onclick = () => this.setCollapsed(!this.collapsed);

    header.append(title, this.limitBadge, this.collapseBtn);

    this.body = document.createElement('div');
    this.body.className = 'ta-goals-panel__body';

    this.suggestionContainer = document.createElement('div');
    this.suggestionContainer.className = 'ta-goals-panel__suggestion-wrap';

    this.form = new GoalForm({
      onAdd: (args) => this.addGoal(args),
    });

    this.listEl = document.createElement('div');
    this.listEl.className = 'ta-goals-list';
    this.listEl.setAttribute('data-testid', 'goals-list');

    this.body.append(this.suggestionContainer, this.form.el, this.listEl);
    this.root.append(header, this.body);
    host.appendChild(this.root);

    if (ctx.services.store?.latest) {
      this.update(ctx.services.store.latest);
    } else {
      this.render();
    }
  }

  private send(kind: string, args: unknown): void {
    const sendFn = this.ctx.services.sendCommand ?? this.ctx.services.store?.sendCommand;
    if (sendFn) {
      void sendFn(kind, args);
    }
  }

  getGoals(): ColonyGoalEntry[] {
    return [...this.goals];
  }

  getOpenGoals(): ColonyGoalEntry[] {
    return this.goals.filter((g) => g.status === 'active' || g.status === 'queued');
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.root.dataset.collapsed = String(collapsed);
    this.body.hidden = collapsed;
    this.collapseBtn.textContent = collapsed ? 'EXPAND' : 'COLLAPSE';
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  addGoal(args: QueueGoalArgs): void {
    const open = this.getOpenGoals();
    if (open.length >= this.goalLimit) return;

    const id = `goal_${this.colonyIndex}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newGoal: ColonyGoalEntry = {
      id,
      goal: args.goal,
      status: open.length === 0 ? 'active' : 'queued',
      params: { ...(args.params ?? {}) },
      progress: 0,
      stepsCompleted: 0,
      stepsTotal: GOAL_CATALOG[args.goal]?.defaultStepsTotal ?? 1,
      budgetBp: args.budgetBp ?? DEFAULT_GOAL_BUDGET_BP,
      spent: {},
      childTaskIds: [],
      createdAtTick: 0,
    };
    this.goals.push(newGoal);
    this.render();

    this.send('queueGoal', {
      goal: args.goal,
      params: args.params ?? {},
      budgetBp: args.budgetBp ?? DEFAULT_GOAL_BUDGET_BP,
    });
  }

  cancelGoal(goalId: string): void {
    this.goals = this.goals.filter((g) => g.id !== goalId);
    const open = this.getOpenGoals();
    if (open.length > 0 && !open.some((g) => g.status === 'active')) {
      open[0].status = 'active';
    }
    this.render();
    this.send('cancelGoal', { goalId });
  }

  reorderGoal(goalId: string, opts: { direction?: 'up' | 'down' | 'top' | 'bottom'; toIndex?: number }): void {
    const open = this.getOpenGoals();
    const fromIdx = open.findIndex((g) => g.id === goalId);
    if (fromIdx >= 0) {
      let targetIdx = fromIdx;
      if (opts.direction === 'up') targetIdx = Math.max(0, fromIdx - 1);
      else if (opts.direction === 'down') targetIdx = Math.min(open.length - 1, fromIdx + 1);
      else if (opts.direction === 'top') targetIdx = 0;
      else if (opts.direction === 'bottom') targetIdx = open.length - 1;
      else if (typeof opts.toIndex === 'number') targetIdx = Math.max(0, Math.min(open.length - 1, opts.toIndex));

      if (targetIdx !== fromIdx) {
        const [moved] = open.splice(fromIdx, 1);
        open.splice(targetIdx, 0, moved);
        open.forEach((g, i) => {
          g.status = i === 0 ? 'active' : 'queued';
        });
        const nonOpen = this.goals.filter((g) => g.status !== 'active' && g.status !== 'queued');
        this.goals = [...open, ...nonOpen];
        this.render();
      }
    }

    if (typeof opts.toIndex === 'number') {
      this.send('reorderGoal', { goalId, toIndex: opts.toIndex });
    } else if (opts.direction) {
      this.send('reorderGoal', { goalId, direction: opts.direction });
    }
  }

  acceptSuggestion(stage = 0, goal: GoalKind = 'establish_colony'): void {
    this.suggestionDismissed = true;
    const open = this.getOpenGoals();
    if (open.length < this.goalLimit) {
      const id = `goal_${this.colonyIndex}_${Date.now()}`;
      this.goals.push({
        id,
        goal,
        status: open.length === 0 ? 'active' : 'queued',
        params: {},
        progress: 0,
        stepsCompleted: 0,
        stepsTotal: GOAL_CATALOG[goal]?.defaultStepsTotal ?? 4,
        budgetBp: GOAL_CATALOG[goal]?.defaultBudgetBp ?? DEFAULT_GOAL_BUDGET_BP,
        spent: {},
        childTaskIds: [],
        createdAtTick: 0,
      });
    }
    this.render();
    this.send('acceptSuggestion', { stage, goal });
  }

  dismissSuggestion(): void {
    this.suggestionDismissed = true;
    this.render();
  }

  update(view?: unknown): void {
    if (!view) return;
    this.colonyIndex = ownColonyIndex(this.ctx.services);
    const col = viewColony(view, this.colonyIndex) as {
      goals?: ColonyGoalEntry[];
      goalLimit?: number;
      stage?: number;
    } | undefined;

    if (col) {
      if (typeof col.goalLimit === 'number') {
        this.goalLimit = col.goalLimit;
      }
      if (Array.isArray(col.goals)) {
        this.goals = col.goals.map((g) => ({
          ...g,
          params: { ...(g.params ?? {}) },
          spent: { ...(g.spent ?? {}) },
          childTaskIds: [...(g.childTaskIds ?? [])],
        }));
      }
      if (typeof col.stage === 'number' && col.stage !== this.colonyStage) {
        this.colonyStage = col.stage;
        this.suggestionDismissed = false;
      }
      this.render();
    }
  }

  render(): void {
    const open = this.getOpenGoals();
    this.limitBadge.textContent = `${open.length} / ${this.goalLimit}`;
    this.form.setDisabled(open.length >= this.goalLimit);

    this.renderSuggestion();
    this.renderList();
  }

  private renderSuggestion(): void {
    renderStageSuggestion(this.suggestionContainer, this.colonyStage, this.goals, this.suggestionDismissed,
      (goal) => this.acceptSuggestion(this.colonyStage, goal), () => this.dismissSuggestion());
  }

  private renderList(): void {
    const open = this.getOpenGoals();
    const listKey = open
      .map(
        (g) =>
          `${g.id}:${g.goal}:${g.status}:${Math.round((g.progress ?? 0) * 100)}:${g.stepsCompleted ?? 0}/${
            g.stepsTotal ?? 1
          }:${g.budgetBp ?? 5000}:${g.detail ?? ""}:${JSON.stringify(g.params ?? {})}`,
      )
      .join('|');
    if (listKey === this.lastListKey && this.listEl.childElementCount === open.length) {
      return;
    }
    this.lastListKey = listKey;
    this.listEl.innerHTML = '';

    for (let i = 0; i < open.length; i++) {
      const entry = open[i];
      const item = this.createGoalItemEl(entry, i);
      this.listEl.appendChild(item);
    }
  }

  private createGoalTopRow(entry: ColonyGoalEntry): HTMLElement {
    const topRow = document.createElement('div');
    topRow.className = 'ta-goal-item__top-row';

    const reorderControls = document.createElement('div');
    reorderControls.className = 'ta-goal-item__reorder';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'ta-goal-item__reorder-btn';
    upBtn.setAttribute('data-testid', `goal-up-${entry.id}`);
    upBtn.textContent = '▲';
    upBtn.title = 'Move Up';
    upBtn.onclick = () => this.reorderGoal(entry.id, { direction: 'up' });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'ta-goal-item__reorder-btn';
    downBtn.setAttribute('data-testid', `goal-down-${entry.id}`);
    downBtn.textContent = '▼';
    downBtn.title = 'Move Down';
    downBtn.onclick = () => this.reorderGoal(entry.id, { direction: 'down' });

    reorderControls.append(upBtn, downBtn);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ta-goal-item__title-wrap';

    const title = document.createElement('span');
    title.className = 'ta-goal-item__title';
    title.textContent = formatGoalLabel(entry.goal, entry.params);

    const statusBadge = document.createElement('span');
    statusBadge.className = `ta-goal-item__status ta-goal-item__status--${entry.status}`;
    statusBadge.setAttribute('data-testid', `goal-status-${entry.id}`);
    statusBadge.textContent = entry.status.toUpperCase();

    titleWrap.append(title, statusBadge);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ta-goal-item__cancel-btn';
    cancelBtn.setAttribute('data-testid', `goal-cancel-${entry.id}`);
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'Cancel Goal';
    cancelBtn.onclick = () => this.cancelGoal(entry.id);

    topRow.append(reorderControls, titleWrap, cancelBtn);
    return topRow;
  }

  private createGoalProgressRow(entry: ColonyGoalEntry): HTMLElement {
    const progressRow = document.createElement('div');
    progressRow.className = 'ta-goal-item__progress-row';

    const pct = Math.round((entry.progress ?? 0) * 100);
    const stepsDone = entry.stepsCompleted ?? 0;
    const stepsTotal = entry.stepsTotal ?? 1;

    const progressTrack = document.createElement('div');
    progressTrack.className = 'ta-goal-item__progress-track';

    const progressBar = document.createElement('div');
    progressBar.className = 'ta-goal-item__progress-bar';
    progressBar.setAttribute('data-testid', `goal-progress-${entry.id}`);
    progressBar.style.width = `${pct}%`;

    const progressText = document.createElement('span');
    progressText.className = 'ta-goal-item__progress-text';
    progressText.textContent = `${pct}% (${stepsDone}/${stepsTotal})`;

    progressBar.appendChild(progressText);
    progressTrack.appendChild(progressBar);

    const budget = document.createElement('span');
    budget.className = 'ta-goal-item__budget';
    budget.setAttribute('data-testid', `goal-budget-${entry.id}`);
    const budgetPct = Math.round((entry.budgetBp ?? 5000) / 100);
    budget.textContent = `Budget: ${budgetPct}%`;

    progressRow.append(progressTrack, budget);
    return progressRow;
  }

  private attachGoalDragAndDrop(item: HTMLElement, goalId: string, itemIndex: number): void {
    item.ondragstart = (e) => {
      this.draggedGoalId = goalId;
      e.dataTransfer?.setData('text/plain', goalId);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      item.classList.add('ta-goal-item--dragging');
    };

    item.ondragend = () => {
      item.classList.remove('ta-goal-item--dragging');
      this.draggedGoalId = null;
    };

    item.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };

    item.ondrop = (e) => {
      e.preventDefault();
      const droppedId = this.draggedGoalId ?? e.dataTransfer?.getData('text/plain');
      if (droppedId) {
        this.reorderGoal(droppedId, { toIndex: itemIndex });
      }
    };
  }

  private createGoalItemEl(entry: ColonyGoalEntry, itemIndex: number): HTMLElement {
    const item = document.createElement('div');
    item.className = 'ta-goal-item';
    item.setAttribute('data-testid', `goal-item-${entry.id}`);
    item.setAttribute('data-goal-kind', entry.goal);
    item.setAttribute('data-goal-status', entry.status);
    item.draggable = true;

    item.append(this.createGoalTopRow(entry), this.createGoalProgressRow(entry));
    const detail = document.createElement('p');
    detail.className = 'ta-goal-detail';
    detail.dataset.testid = `goal-detail-${entry.id}`;
    detail.textContent = entry.status === 'queued' ? 'Waiting for the active goal. Move up to prioritize.' : entry.detail ?? 'Planning work…';
    item.append(detail);
    this.attachGoalDragAndDrop(item, entry.id, itemIndex);
    return item;
  }

  dispose(): void {
    this.root.remove();
  }
}
