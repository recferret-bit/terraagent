import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import { ownColonyIndex } from '../shared/colony';
import { supplyBlockReason, supplyLevel } from '../shared/supply';
import {
  ArmySectionController,
  createProgressBarElement,
  formatBufferItem,
  resolveUnitQueueEntries,
  type QueueItemLike,
} from './ArmySection';
import { buildUnitsCatalog, resolveSupply, type SupplySummary, type UnitCardModel } from './catalog';

export { formatBufferItem, type QueueItemLike };

interface CachedUnitCard {
  readonly root: HTMLElement;
  readonly title: HTMLElement;
  readonly supplyTag: HTMLElement;
  readonly time: HTMLElement;
  readonly power: HTMLElement;
  readonly costs: HTMLElement;
  readonly countSpan: HTMLElement;
  readonly repeatBtn: HTMLButtonElement;
  readonly queueBtn: HTMLButtonElement;
  reason: HTMLElement | null;
  unlockDetail: HTMLElement | null;
  card: UnitCardModel;
  readonly supplyReason: HTMLElement;
  costKey: string;
}

export class UnitsMenu implements Disposable {
  readonly root: HTMLElement;
  private readonly headBtn: HTMLButtonElement;
  private readonly supplyEl: HTMLElement;
  private readonly cardsContainer: HTMLElement;
  private readonly bufferContainer: HTMLElement;
  private readonly army: ArmySectionController | null = null;
  private readonly cardElements = new Map<string, CachedUnitCard>();
  private lastBufferKey: string | null = null;
  private isOpen = true;
  private view?: GameView;
  count = 1;
  repeat = false;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(
    private readonly el: HTMLElement,
    private readonly ctx: FeatureContext,
    initialView?: GameView,
  ) {
    this.view = initialView;
    const hasW07 = this.ctx.flags.has('W07');
    this.root = document.createElement('div');
    this.root.className = 'ta-units plate-sm';
    this.root.dataset.open = 'true';

    const header = document.createElement('div');
    header.className = 'ta-units__header';

    this.headBtn = document.createElement('button');
    this.headBtn.type = 'button';
    this.headBtn.className = 'ta-units__toggle';
    this.headBtn.textContent = 'UNITS [U]';
    this.headBtn.setAttribute('aria-expanded', 'true');
    this.headBtn.onclick = () => this.toggle();

    this.supplyEl = document.createElement('span');
    this.supplyEl.className = 'ta-units__supply';
    this.supplyEl.setAttribute('data-supply', '');
    this.supplyEl.setAttribute('data-warning', 'false');
    this.supplyEl.setAttribute('data-level', 'ok');
    this.supplyEl.title = hasW07
      ? 'Unit supply: used / cap (+10 Command Hub, +8 per Drone Control Array)'
      : 'Unit supply: used / cap';
    this.supplyEl.textContent = '— / —';

    header.append(this.headBtn, this.supplyEl);
    this.root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'ta-units__body';
    body.setAttribute('data-body', '');

    this.cardsContainer = document.createElement('div');
    this.cardsContainer.className = 'ta-units__cards';
    this.cardsContainer.setAttribute('data-cards', '');
    body.appendChild(this.cardsContainer);

    if (hasW07) {
      this.army = new ArmySectionController(this.root, this.cardsContainer, body, this.ctx);
      const s = this.ctx.services as unknown as Record<string, unknown>;
      s.setRally = (q: number, r: number, producerId?: number) => this.setRally(q, r, producerId);
    }

    const bufferSection = document.createElement('div');
    bufferSection.className = 'ta-units__buffer-section';

    const bufferHead = document.createElement('div');
    bufferHead.className = 'ta-units__buffer-header';
    const bufferTitle = document.createElement('span');
    bufferTitle.className = 'ta-units__buffer-title';
    bufferTitle.textContent = 'Hub Buffer';
    bufferHead.appendChild(bufferTitle);
    bufferSection.appendChild(bufferHead);

    this.bufferContainer = document.createElement('div');
    this.bufferContainer.className = 'ta-units__buffer';
    this.bufferContainer.setAttribute('data-unit-buffer', '');
    bufferSection.appendChild(this.bufferContainer);

    body.appendChild(bufferSection);
    this.root.appendChild(body);
    this.el.appendChild(this.root);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (isGameInputBlocked()) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Escape' && this.army?.isRallyMode()) {
        this.army.setRallyMode(false);
        return;
      }
      if (e.key === 'u' || e.key === 'U') {
        this.toggle();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }

    this.render();
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.root.dataset.open = String(open);
    this.headBtn.setAttribute('aria-expanded', String(open));
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  isRallyMode(): boolean {
    return this.army?.isRallyMode() ?? false;
  }

  setRally(q: number, r: number, producerId?: number): void {
    if (this.army) {
      this.army.setRally(q, r, producerId);
    } else {
      this.ctx.services.sendCommand?.('setRally', producerId !== undefined ? { q, r, producerId } : { q, r });
    }
  }

  update(view: GameView): void {
    this.view = view;
    this.render();
  }

  private render(): void {
    const supply = resolveSupply(this.view, ownColonyIndex(this.ctx.services));
    this.renderSupply(supply);
    this.renderCards(supply);
    this.renderBuffer();
  }

  private renderSupply(supply: SupplySummary | null): void {
    const level = supplyLevel(supply);
    this.supplyEl.textContent = supply ? `${supply.used} / ${supply.cap}` : '— / —';
    this.supplyEl.setAttribute('data-warning', String(level === 'full'));
    this.supplyEl.setAttribute('data-level', level);
  }

  private renderCards(supply: SupplySummary | null): void {
    const cards = buildUnitsCatalog(this.ctx.flags, this.view);
    const seen = new Set<string>();
    for (const card of cards) {
      seen.add(card.unit);
      const existing = this.cardElements.get(card.unit);
      const cached = existing ?? this.createCardElement(card);
      if (existing) {
        this.updateCardElement(existing, card);
      } else {
        this.cardElements.set(card.unit, cached);
        const container = card.section === 'army' && this.army ? this.army.cardsEl : this.cardsContainer;
        container.appendChild(cached.root);
      }
      this.applySupplyBlock(cached, supplyBlockReason(supply, card.supply));
    }
    if (this.army && this.army.sectionEl.parentElement === this.cardsContainer) {
      this.cardsContainer.appendChild(this.army.sectionEl);
    }
    for (const [unit, cached] of this.cardElements) {
      if (!seen.has(unit)) {
        cached.root.remove();
        this.cardElements.delete(unit);
      }
    }
  }

  /** At the cap the QUEUE button is disabled and the card says why (the host would reject with `supply_cap`). */
  private applySupplyBlock(cached: CachedUnitCard, reason: string | null): void {
    cached.root.setAttribute('data-supply-blocked', String(reason !== null));
    cached.queueBtn.disabled = reason !== null || Boolean(cached.card.disabled);
    const defaultTitle =
      cached.card.section === 'army' ? 'Queue this unit at the Robotics Factory' : 'Queue this unit at the Command Hub';
    cached.queueBtn.title = reason ?? cached.card.disabledReason ?? defaultTitle;
    cached.supplyReason.hidden = reason === null;
    if (reason !== null && cached.supplyReason.textContent !== reason) cached.supplyReason.textContent = reason;
  }

  private updateCardElement(cached: CachedUnitCard, card: UnitCardModel): void {
    cached.card = card;
    if (cached.title.textContent !== card.label) cached.title.textContent = card.label;
    const supplyText = `Supply ${card.supply}`;
    if (cached.supplyTag.textContent !== supplyText) cached.supplyTag.textContent = supplyText;
    const timeText = `${card.buildS}s`;
    if (cached.time.textContent !== timeText) cached.time.textContent = timeText;
    if (cached.power.textContent !== card.powerText) cached.power.textContent = card.powerText;

    const costKey = card.costPills.join('|');
    if (cached.costKey !== costKey) {
      cached.costKey = costKey;
      cached.costs.replaceChildren();
      for (const pillText of card.costPills) {
        const pill = document.createElement('span');
        pill.className = 'ta-units__cost-pill';
        pill.textContent = pillText;
        cached.costs.appendChild(pill);
      }
    }

    cached.countSpan.textContent = String(this.count);
    cached.countSpan.setAttribute('data-count', String(this.count));
    cached.repeatBtn.setAttribute('data-repeat', String(this.repeat));
    this.syncUnitCardLockState(cached, card);
  }

  private syncUnitCardLockState(cached: CachedUnitCard, card: UnitCardModel): void {
    const disabled = Boolean(card.disabled);
    cached.root.className = card.stageLocked ? 'ta-units__card plate-sm is-stage-locked' : 'ta-units__card plate-sm';
    cached.root.setAttribute('data-disabled', String(disabled));
    cached.root.setAttribute('data-unlock-stage', String(card.unlockStage));
    cached.queueBtn.disabled = disabled;
    cached.queueBtn.setAttribute('data-disabled', String(disabled));

    if (card.stageLocked) {
      cached.root.setAttribute('data-stage-locked', 'true');
      const cond = card.unlockConditionText ?? card.disabledReason ?? '';
      const detail = card.unlockDetailText ?? cond;
      const fullTooltip = detail && detail !== cond ? `${cond} (${detail})` : cond;
      cached.root.setAttribute('title', fullTooltip);
      cached.root.setAttribute('aria-label', `${card.label} — ${fullTooltip}`);
      cached.root.setAttribute('data-unlock-detail', detail);
    } else if (typeof cached.root.removeAttribute === 'function') {
      for (const attr of ['data-stage-locked', 'title', 'aria-label', 'data-unlock-detail']) {
        cached.root.removeAttribute(attr);
      }
    }

    if (disabled && card.disabledReason) {
      if (!cached.reason) {
        cached.reason = document.createElement('span');
        cached.reason.className = 'ta-units__reason';
        cached.root.appendChild(cached.reason);
      }
      if (cached.reason.textContent !== card.disabledReason) {
        cached.reason.textContent = card.disabledReason;
      }
      const detail = card.unlockDetailText ?? '';
      if (card.stageLocked && detail && detail !== card.disabledReason) {
        if (!cached.unlockDetail) {
          cached.unlockDetail = document.createElement('span');
          cached.unlockDetail.className = 'ta-units__unlock-detail';
          cached.root.appendChild(cached.unlockDetail);
        }
        if (cached.unlockDetail.textContent !== detail) {
          cached.unlockDetail.textContent = detail;
        }
      } else if (cached.unlockDetail) {
        cached.unlockDetail.remove();
        cached.unlockDetail = null;
      }
    } else {
      if (cached.reason) {
        cached.reason.remove();
        cached.reason = null;
      }
      if (cached.unlockDetail) {
        cached.unlockDetail.remove();
        cached.unlockDetail = null;
      }
    }
  }

  private createCardElement(card: UnitCardModel): CachedUnitCard {
    const cardEl = document.createElement('div');
    cardEl.className = 'ta-units__card plate-sm';
    cardEl.setAttribute('data-unit', card.unit);
    if (card.section) cardEl.setAttribute('data-unit-section', card.section);

    const headRow = document.createElement('div');
    headRow.className = 'ta-units__card-head';
    const title = document.createElement('span');
    title.className = 'ta-units__title';
    title.textContent = card.label;
    const supplyTag = document.createElement('span');
    supplyTag.className = 'ta-units__supply-tag';
    supplyTag.textContent = `Supply ${card.supply}`;
    headRow.append(title, supplyTag);

    const metaRow = document.createElement('div');
    metaRow.className = 'ta-units__meta';
    const time = document.createElement('span');
    time.className = 'ta-units__time';
    time.textContent = `${card.buildS}s`;
    const power = document.createElement('span');
    power.className = 'ta-units__power';
    power.textContent = card.powerText;
    metaRow.append(time, power);

    const costs = document.createElement('div');
    costs.className = 'ta-units__costs';
    for (const pillText of card.costPills) {
      const pill = document.createElement('span');
      pill.className = 'ta-units__cost-pill';
      pill.textContent = pillText;
      costs.appendChild(pill);
    }

    const { controls, countSpan, repeatBtn, queueBtn } = this.createControlsRow(card);
    const supplyReason = document.createElement('div');
    supplyReason.className = 'ta-units__supply-reason';
    supplyReason.setAttribute('data-supply-reason', '');
    supplyReason.hidden = true;
    cardEl.append(headRow, metaRow, costs, controls, supplyReason);
    const cached: CachedUnitCard = {
      root: cardEl,
      title,
      supplyTag,
      time,
      power,
      costs,
      countSpan,
      repeatBtn,
      queueBtn,
      supplyReason,
      reason: null,
      unlockDetail: null,
      card,
      costKey: card.costPills.join('|'),
    };
    this.syncUnitCardLockState(cached, card);
    return cached;
  }

  private createControlsRow(card: UnitCardModel): {
    controls: HTMLElement;
    countSpan: HTMLElement;
    repeatBtn: HTMLButtonElement;
    queueBtn: HTMLButtonElement;
  } {
    const unit = card.unit;
    const controls = document.createElement('div');
    controls.className = 'ta-units__controls';

    const stepper = document.createElement('div');
    stepper.className = 'ta-units__stepper';

    const decBtn = document.createElement('button');
    decBtn.type = 'button';
    decBtn.className = 'ta-units__stepper-btn';
    decBtn.setAttribute('data-count-dec', '');
    decBtn.textContent = '−';
    decBtn.onclick = () => {
      this.count = Math.max(1, this.count - 1);
      this.updateCountReadouts();
    };

    const countSpan = document.createElement('span');
    countSpan.className = 'ta-units__count';
    countSpan.setAttribute('data-count', String(this.count));
    countSpan.textContent = String(this.count);

    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = 'ta-units__stepper-btn';
    incBtn.setAttribute('data-count-inc', '');
    incBtn.textContent = '+';
    incBtn.onclick = () => {
      this.count = Math.min(5, this.count + 1);
      this.updateCountReadouts();
    };
    stepper.append(decBtn, countSpan, incBtn);

    const repeatBtn = document.createElement('button');
    repeatBtn.type = 'button';
    repeatBtn.className = 'ta-units__repeat-btn';
    repeatBtn.setAttribute('data-repeat', String(this.repeat));
    repeatBtn.textContent = 'REPEAT';
    repeatBtn.onclick = () => {
      this.repeat = !this.repeat;
      this.updateRepeatButtons();
    };

    const queueBtn = document.createElement('button');
    queueBtn.type = 'button';
    queueBtn.className = 'ta-units__queue-btn';
    queueBtn.setAttribute('data-queue-unit', unit);
    queueBtn.textContent = 'QUEUE';
    queueBtn.onclick = () => {
      if (this.cardElements.get(unit)?.card.disabled) return;
      this.queueUnit(unit);
    };

    controls.append(stepper, repeatBtn, queueBtn);
    return { controls, countSpan, repeatBtn, queueBtn };
  }

  private updateCountReadouts(): void {
    const readouts = this.root.querySelectorAll('[data-count]');
    for (const el of readouts) {
      el.textContent = String(this.count);
      el.setAttribute('data-count', String(this.count));
    }
  }

  private updateRepeatButtons(): void {
    const btns = this.root.querySelectorAll('[data-repeat]');
    for (const el of btns) {
      el.setAttribute('data-repeat', String(this.repeat));
    }
  }

  private queueUnit(unit: string): void {
    const payload = {
      task: {
        kind: 'buildUnit' as const,
        unit,
        count: this.count,
        repeat: this.repeat,
      },
    };
    this.ctx.services.sendCommand?.('enqueueTask', payload);

    const s = this.ctx.services as unknown as {
      enqueueHubUnit?: (opts: { unit?: string; count?: number; repeat?: boolean }) => unknown;
    };
    if (typeof s.enqueueHubUnit === 'function') {
      s.enqueueHubUnit({ unit, count: this.count, repeat: this.repeat });
    }
  }

  private renderBuffer(): void {
    const own = ownColonyIndex(this.ctx.services);
    const entries = resolveUnitQueueEntries(this.view, own);
    this.army?.render(entries, this.view, own);

    const nextKey = entries.map((en) => `${en.taskId ?? ''}:${formatBufferItem(en)}`).join('|');
    if (this.lastBufferKey === nextKey) return;
    this.lastBufferKey = nextKey;

    this.bufferContainer.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'ta-units__buffer-empty';
      empty.textContent = 'Queue empty';
      this.bufferContainer.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const itemEl = document.createElement('div');
      itemEl.className = 'ta-units__buffer-item';
      if (entry.taskId) itemEl.setAttribute('data-task-id', entry.taskId);
      itemEl.textContent = formatBufferItem(entry);
      if (this.army) {
        const pct = entry.state === 'in_progress' ? Math.round((entry.progress ?? 0) * 100) : 0;
        itemEl.appendChild(createProgressBarElement(pct));
      }
      this.bufferContainer.appendChild(itemEl);
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.army?.dispose();
    this.cardElements.clear();
    this.root.remove();
  }
}
