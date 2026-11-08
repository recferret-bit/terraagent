import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import { releaseArchetypeThumbs, retainArchetypeThumbs } from '../shared/archetypeThumb';
import { type MenuTier, presentTiers, rememberTier, renderTierBar, setTierVisible } from '../shared/menuCards';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { supplyBlockReason, supplyLevel } from '../shared/supply';
import { buildUnitsCatalog, resolveSupply, type SupplySummary, type UnitCardModel } from './catalog';
import { createUnitCard, syncUnitCard, type UnitCardHandle } from './unitCard';

interface QueueItemLike {
  taskId?: string;
  unit?: string;
  tier?: number;
  count?: number;
  remainingCount?: number;
  repeat?: boolean;
  state?: string;
  waitReason?: string;
  waitDetail?: string;
  progress?: number;
}

function bufferUnitLabel(entry: QueueItemLike): string {
  const task = (entry as { task?: { unit?: string; tier?: number } }).task;
  const unit = entry.unit ?? task?.unit ?? 'worker';
  const tier = entry.tier ?? task?.tier;
  const shown = tier === 2 || tier === 3 ? tier : 1;
  return unit === 'worker' ? `Worker Drone T${shown}` : unit;
}

export function formatBufferItem(entry: QueueItemLike): string {
  const unit = bufferUnitLabel(entry);
  const cnt = entry.remainingCount ?? entry.count ?? 1;
  const repeatIcon = entry.repeat ? ' ↻' : '';
  let status = entry.state ?? 'queued';
  if (entry.state === 'in_progress') status = `in_progress ${Math.round((entry.progress ?? 0) * 100)}%`;
  else if (entry.state === 'waiting') status = entry.waitDetail ?? (entry.waitReason ? `waiting(${entry.waitReason})` : 'waiting(supply)');
  return `${unit} ×${cnt}${repeatIcon} · ${status}`;
}

export class UnitsMenu implements Disposable {
  readonly root: HTMLElement;
  private readonly headBtn: HTMLButtonElement;
  private readonly supplyEl: HTMLElement;
  private readonly tierBar: HTMLElement;
  private readonly cardsContainer: HTMLElement;
  private readonly bufferContainer: HTMLElement;
  private readonly countSpan: HTMLElement;
  private readonly repeatBtn: HTMLButtonElement;
  private readonly cardElements = new Map<string, UnitCardHandle>();
  private lastBufferKey: string | null = null;
  private pickedTier: MenuTier | null = null;
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
    retainArchetypeThumbs();
    this.view = initialView;
    this.root = document.createElement('div');
    this.root.className = 'ta-units plate-sm';
    this.root.dataset.open = 'true';
    const header = this.buildHeader();
    this.headBtn = header.toggle;
    this.supplyEl = header.supply;
    const body = document.createElement('div');
    body.className = 'ta-units__body';
    body.setAttribute('data-body', '');
    this.tierBar = document.createElement('div');
    const batch = this.buildBatch();
    this.countSpan = batch.countSpan;
    this.repeatBtn = batch.repeatBtn;
    this.cardsContainer = document.createElement('div');
    this.cardsContainer.className = 'ta-units__cards';
    this.cardsContainer.setAttribute('data-cards', '');
    const buffer = this.buildBuffer();
    this.bufferContainer = buffer.list;
    body.append(this.tierBar, batch.root, this.cardsContainer, buffer.section);
    this.root.append(header.row, body);
    this.el.appendChild(this.root);
    this.onKeyDown = (event: KeyboardEvent) => this.onUnitsKey(event);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown);
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

  private buildHeader(): { row: HTMLElement; toggle: HTMLButtonElement; supply: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'ta-units__header';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ta-units__toggle';
    toggle.textContent = 'UNITS [U]';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.onclick = () => this.toggle();
    const supply = document.createElement('span');
    supply.className = 'ta-units__supply';
    supply.setAttribute('data-supply', '');
    supply.setAttribute('data-warning', 'false');
    supply.setAttribute('data-level', 'ok');
    supply.title = 'Unit supply: used / cap';
    supply.textContent = '— / —';
    row.append(toggle, supply);
    return { row, toggle, supply };
  }

  private buildBatch(): { root: HTMLElement; countSpan: HTMLElement; repeatBtn: HTMLButtonElement } {
    const root = document.createElement('div');
    root.className = 'ta-units__batch';
    const stepper = document.createElement('div');
    stepper.className = 'ta-units__stepper';
    const decBtn = document.createElement('button');
    decBtn.type = 'button';
    decBtn.className = 'ta-units__stepper-btn';
    decBtn.setAttribute('data-count-dec', '');
    decBtn.textContent = '−';
    decBtn.onclick = () => this.setCount(this.count - 1);
    const countSpan = document.createElement('span');
    countSpan.className = 'ta-units__count';
    countSpan.setAttribute('data-count', '1');
    countSpan.textContent = '1';
    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = 'ta-units__stepper-btn';
    incBtn.setAttribute('data-count-inc', '');
    incBtn.textContent = '+';
    incBtn.onclick = () => this.setCount(this.count + 1);
    stepper.append(decBtn, countSpan, incBtn);
    const repeatBtn = document.createElement('button');
    repeatBtn.type = 'button';
    repeatBtn.className = 'ta-units__repeat-btn';
    repeatBtn.setAttribute('data-repeat', 'false');
    repeatBtn.textContent = 'REPEAT';
    repeatBtn.onclick = () => {
      this.repeat = !this.repeat;
      repeatBtn.setAttribute('data-repeat', String(this.repeat));
    };
    root.append(stepper, repeatBtn);
    return { root, countSpan, repeatBtn };
  }

  private buildBuffer(): { section: HTMLElement; list: HTMLElement } {
    const section = document.createElement('div');
    section.className = 'ta-units__buffer-section';
    const head = document.createElement('div');
    head.className = 'ta-units__buffer-header';
    const title = document.createElement('span');
    title.className = 'ta-units__buffer-title';
    title.textContent = 'Hub Buffer';
    head.appendChild(title);
    const list = document.createElement('div');
    list.className = 'ta-units__buffer';
    list.setAttribute('data-unit-buffer', '');
    section.append(head, list);
    return { section, list };
  }

  private onUnitsKey(event: KeyboardEvent): void {
    if ((event.key !== 'u' && event.key !== 'U') || isGameInputBlocked()) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    this.toggle();
  }

  private setCount(next: number): void {
    this.count = Math.max(1, Math.min(5, next));
    this.countSpan.textContent = String(this.count);
    this.countSpan.setAttribute('data-count', String(this.count));
  }

  private render(): void {
    const supply = resolveSupply(this.view, ownColonyIndex(this.ctx.services));
    this.renderSupply(supply);
    this.renderCards(buildUnitsCatalog(this.ctx.flags, this.view), supply);
    this.renderBuffer();
  }

  private renderSupply(supply: SupplySummary | null): void {
    const level = supplyLevel(supply);
    this.supplyEl.textContent = supply ? `${supply.used} / ${supply.cap}` : '— / —';
    this.supplyEl.setAttribute('data-warning', String(level === 'full'));
    this.supplyEl.setAttribute('data-level', level);
  }

  private renderCards(cards: UnitCardModel[], supply: SupplySummary | null): void {
    const tier = rememberTier(this.pickedTier, cards);
    this.pickedTier = tier;
    renderTierBar(this.tierBar, 'prod', presentTiers(cards), tier, (next) => {
      this.pickedTier = next;
      this.render();
    });
    const seen = new Set<string>();
    for (const card of cards) {
      seen.add(card.id);
      const handle = this.cardElements.get(card.id) ?? this.mountCard(card);
      syncUnitCard(handle, card);
      this.applySupplyBlock(handle, supplyBlockReason(supply, card.supply));
      setTierVisible(handle.root, card.tier === tier);
    }
    for (const [id, handle] of this.cardElements) {
      if (seen.has(id)) continue;
      handle.root.remove();
      handle.tip.remove(); // an open tip is parked on document.body (`bindCardTip`)
      this.cardElements.delete(id);
    }
  }

  private mountCard(card: UnitCardModel): UnitCardHandle {
    const handle = createUnitCard(card, (queued) => this.queueUnit(queued));
    this.cardElements.set(card.id, handle);
    this.cardsContainer.appendChild(handle.root);
    return handle;
  }

  /** At the cap the card is disabled and says why (the host would reject with `supply_cap`). */
  private applySupplyBlock(handle: UnitCardHandle, reason: string | null): void {
    const blocked = reason !== null;
    handle.root.setAttribute('data-supply-blocked', String(blocked));
    if (!handle.card.disabled) handle.root.disabled = blocked;
    handle.supplyReason.hidden = !blocked;
    if (blocked && handle.supplyReason.textContent !== reason) handle.supplyReason.textContent = reason ?? '';
  }

  private queueUnit(card: UnitCardModel): void {
    const tier = card.tier === 2 || card.tier === 3 ? card.tier : 1;
    const task = { kind: 'buildUnit' as const, unit: card.unit, tier, count: this.count, repeat: this.repeat };
    this.ctx.services.sendCommand?.('enqueueTask', { task });
    this.ctx.services.enqueueHubUnit?.({ unit: card.unit, tier, count: this.count, repeat: this.repeat });
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
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    for (const handle of this.cardElements.values()) handle.tip.remove();
    this.cardElements.clear();
    this.root.remove();
    releaseArchetypeThumbs();
  }
}
