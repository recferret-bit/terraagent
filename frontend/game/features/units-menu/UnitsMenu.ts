import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { supplyBlockReason, supplyLevel } from '../shared/supply';
import { buildUnitsCatalog, resolveSupply, type SupplySummary, type UnitCardModel } from './catalog';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';

interface QueueItemLike {
  taskId?: string;
  unit?: string;
  count?: number;
  remainingCount?: number;
  repeat?: boolean;
  state?: string;
  waitReason?: string;
  waitDetail?: string;
  progress?: number;
}

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
  readonly reason: HTMLElement;
  costKey: string;
}

export function formatBufferItem(entry: QueueItemLike): string {
  const unit = entry.unit ?? 'harvester';
  const cnt = entry.remainingCount ?? entry.count ?? 1;
  const repeatIcon = entry.repeat ? ' ↻' : '';
  let status = entry.state ?? 'queued';

  if (entry.state === 'in_progress') {
    const pct = Math.round((entry.progress ?? 0) * 100);
    status = `in_progress ${pct}%`;
  } else if (entry.state === 'waiting') {
    status = entry.waitDetail ?? (entry.waitReason ? `waiting(${entry.waitReason})` : 'waiting(supply)');
  }

  return `${unit} ×${cnt}${repeatIcon} · ${status}`;
}

export class UnitsMenu implements Disposable {
  readonly root: HTMLElement;
  private readonly headBtn: HTMLButtonElement;
  private readonly supplyEl: HTMLElement;
  private readonly cardsContainer: HTMLElement;
  private readonly bufferContainer: HTMLElement;
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
    this.supplyEl.title = 'Unit supply: used / cap';
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
      if ((e.key === 'u' || e.key === 'U') && !isGameInputBlocked()) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
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
        this.cardsContainer.appendChild(cached.root);
      }
      this.applySupplyBlock(cached, supplyBlockReason(supply, card.supply));
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
    cached.queueBtn.disabled = reason !== null;
    cached.queueBtn.title = reason ?? 'Queue this unit at the Command Hub';
    cached.reason.hidden = reason === null;
    if (reason !== null && cached.reason.textContent !== reason) cached.reason.textContent = reason;
  }

  private updateCardElement(cached: CachedUnitCard, card: UnitCardModel): void {
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
  }

  private createCardElement(card: UnitCardModel): CachedUnitCard {
    const cardEl = document.createElement('div');
    cardEl.className = 'ta-units__card plate-sm';
    cardEl.setAttribute('data-unit', card.unit);

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

    const { controls, countSpan, repeatBtn, queueBtn } = this.createControlsRow(card.unit);
    const reason = document.createElement('div');
    reason.className = 'ta-units__reason';
    reason.setAttribute('data-supply-reason', '');
    reason.hidden = true;
    cardEl.append(headRow, metaRow, costs, controls, reason);
    return {
      root: cardEl,
      title,
      supplyTag,
      time,
      power,
      costs,
      countSpan,
      repeatBtn,
      queueBtn,
      reason,
      costKey: card.costPills.join('|'),
    };
  }

  private createControlsRow(unit: string): {
    controls: HTMLElement;
    countSpan: HTMLElement;
    repeatBtn: HTMLButtonElement;
    queueBtn: HTMLButtonElement;
  } {
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
    queueBtn.onclick = () => this.queueUnit(unit);

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
    const v = this.view as { blobs?: { hubProduction?: { entries?: Array<QueueItemLike & { colonyIndex?: number }> } } } | undefined;
    const own = ownColonyIndex(this.ctx.services);
    const raw = (viewColony(this.view, own)?.unitQueue as QueueItemLike[] | undefined)
      ?? (v?.blobs?.hubProduction?.entries ?? []).filter((en) => (en.colonyIndex ?? own) === own);
    const entries = raw.filter((en) => en.state !== 'done' && en.state !== 'cancelled');
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
      this.bufferContainer.appendChild(itemEl);
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.cardElements.clear();
    this.root.remove();
  }
}
