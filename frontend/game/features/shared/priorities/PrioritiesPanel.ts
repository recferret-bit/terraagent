import type { PriorityKey } from '@terra/contracts';
import type { FeatureContext } from '../../../core/registry/types';
import { ownColonyIndex, viewColony } from '../colony';
import { PrioritySliders } from './PrioritySliders';
import { loadPriorities, savePriorities } from './storage';

const DEFAULT_PRIORITIES: Record<PriorityKey, number> = {
  economy: 50,
  expansion: 50,
  defense: 50,
  power: 50,
  terraform: 50,
};

export class PrioritiesPanel {
  readonly root: HTMLElement;
  private readonly ctx: FeatureContext;
  private readonly sliders: PrioritySliders<PriorityKey>;
  private readonly sumBadge: HTMLElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly body: HTMLElement;
  private collapsed = false;
  private colonyIndex = 0;
  private planetId: string | null = null;
  private lastPrioritiesKey = '';

  constructor(host: HTMLElement, ctx: FeatureContext) {
    this.ctx = ctx;
    this.colonyIndex = ownColonyIndex(ctx.services);
    this.planetId = ctx.services.session?.planetId() ?? ctx.services.store?.currentPlanetId?.() ?? null;

    this.root = document.createElement('section');
    this.root.className = 'ta-priorities-panel plate-sm';
    this.root.setAttribute('data-testid', 'priorities-panel');
    this.root.dataset.collapsed = 'false';

    const readOnly = Boolean(ctx.services.isSpectator?.() || ctx.services.store?.isSpectator?.());
    const stored = readOnly ? null : loadPriorities<PriorityKey>(this.planetId, this.colonyIndex);

    this.sliders = new PrioritySliders<PriorityKey>({
      initialValues: stored ?? undefined,
      onChange: (values) => this.onSlidersChange(values),
    });
    this.sliders.setDisabled(readOnly);

    const header = document.createElement('div');
    header.className = 'ta-priorities-panel__header';

    const title = document.createElement('span');
    title.className = 'ta-priorities-panel__title';
    title.textContent = 'HQ PRIORITIES';

    this.sumBadge = document.createElement('span');
    this.sumBadge.className = 'ta-priorities-panel__badge';
    this.sumBadge.setAttribute('data-testid', 'priority-badge-sum');
    this.sumBadge.textContent = String(this.sliders.getSum());

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'ta-priorities-panel__collapse-btn';
    this.collapseBtn.setAttribute('data-testid', 'priority-collapse-btn');
    this.collapseBtn.dataset.priorityCollapse = 'true';
    this.collapseBtn.textContent = 'COLLAPSE';
    this.collapseBtn.onclick = () => this.setCollapsed(!this.collapsed);

    header.append(title, this.sumBadge, this.collapseBtn);

    this.body = document.createElement('div');
    this.body.className = 'ta-priorities-panel__body';
    this.body.appendChild(this.sliders.el);

    this.root.append(header, this.body);
    host.appendChild(this.root);

    // Initial sync from store's latest view if available
    if (ctx.services.store?.latest) {
      this.update(ctx.services.store.latest);
    }
  }

  private isReadOnly(): boolean {
    return Boolean(this.ctx.services.isSpectator?.() || this.ctx.services.store?.isSpectator?.());
  }

  private onSlidersChange(values: Record<PriorityKey, number>): void {
    if (this.isReadOnly()) return;
    this.sumBadge.textContent = String(this.sliders.getSum());
    savePriorities(values, this.planetId, this.colonyIndex);
    this.dispatchPriorities(values);
  }

  private dispatchPriorities(values: Record<PriorityKey, number>): void {
    if (this.isReadOnly()) return;
    const send = this.ctx.services.sendCommand ?? this.ctx.services.store?.sendCommand;
    if (send) {
      void send('setPriorities', { ...values });
    }
  }

  update(view?: unknown): void {
    if (!view) return;
    const readOnly = this.isReadOnly();
    this.sliders.setDisabled(readOnly);
    const nextColony = ownColonyIndex(this.ctx.services);
    const colonyChanged = nextColony !== this.colonyIndex;
    this.colonyIndex = nextColony;
    this.planetId = this.ctx.services.session?.planetId() ?? this.ctx.services.store?.currentPlanetId?.() ?? null;

    const col = viewColony(view, this.colonyIndex) as { priorities?: Record<PriorityKey, number> } | undefined;
    if (col?.priorities && typeof col.priorities === 'object') {
      const nextKey = `${this.colonyIndex}:${col.priorities.economy ?? ''}:${col.priorities.expansion ?? ''}:${col.priorities.defense ?? ''}:${col.priorities.power ?? ''}:${col.priorities.terraform ?? ''}`;
      if (nextKey !== this.lastPrioritiesKey) {
        this.lastPrioritiesKey = nextKey;
        this.sliders.setValues(col.priorities, false);
        this.sumBadge.textContent = String(this.sliders.getSum());
        if (!readOnly) {
          savePriorities(this.sliders.getValues(), this.planetId, this.colonyIndex);
        }
      }
    } else if (colonyChanged) {
      this.lastPrioritiesKey = `${this.colonyIndex}:default`;
      this.sliders.setValues(DEFAULT_PRIORITIES, false);
      this.sumBadge.textContent = String(this.sliders.getSum());
    }
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

  getValues(): Record<PriorityKey, number> {
    return this.sliders.getValues();
  }

  setValues(values: Partial<Record<PriorityKey, number>>, emitChange = false): void {
    this.sliders.setValues(values, emitChange);
    this.sumBadge.textContent = String(this.sliders.getSum());
  }

  dispose(): void {
    this.sliders.dispose();
    this.root.remove();
  }
}
