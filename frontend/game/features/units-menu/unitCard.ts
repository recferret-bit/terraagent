import { applyStageLockAttrs, bindCardTip, clearStageLockAttrs, createMenuCardFace, shortResourceLine, syncCostPills, workerRole } from '../shared/menuCards';
import type { UnitCardModel } from './catalog';

export interface UnitCardHandle {
  readonly root: HTMLButtonElement;
  readonly tip: HTMLElement;
  readonly nameEl: HTMLElement;
  readonly title: HTMLElement;
  readonly tierEl: HTMLElement;
  readonly price: HTMLElement;
  readonly shortTime: HTMLElement;
  readonly time: HTMLElement;
  readonly power: HTMLElement;
  readonly costs: HTMLElement;
  readonly supplyEl: HTMLElement;
  readonly roleEl: HTMLElement;
  readonly supplyReason: HTMLElement;
  reason: HTMLElement | null;
  unlockDetail: HTMLElement | null;
  card: UnitCardModel;
  costKey: string;
}

export function createUnitCard(card: UnitCardModel, onQueue: (card: UnitCardModel) => void): UnitCardHandle {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'ta-units__card plate-sm';
  root.setAttribute('data-unit', card.unit);
  root.setAttribute('data-tier', String(card.tier));
  root.setAttribute('data-queue-tier', String(card.tier));
  root.setAttribute('data-queue-unit', card.unit);

  const supplyReason = document.createElement('span');
  supplyReason.className = 'ta-units__supply-reason';
  supplyReason.setAttribute('data-supply-reason', '');
  supplyReason.hidden = true;
  const face = createMenuCardFace('ta-units__title', card.archetype, supplyReason);

  const tip = document.createElement('span');
  tip.className = 'ta-card-tip';
  tip.setAttribute('role', 'tooltip');
  const nameEl = document.createElement('span');
  nameEl.className = 'ta-card-tip__name';
  const time = document.createElement('span');
  time.className = 'ta-units__time';
  const power = document.createElement('span');
  power.className = 'ta-units__power';
  const costs = document.createElement('span');
  costs.className = 'ta-units__costs';
  const supplyEl = document.createElement('span');
  supplyEl.className = 'ta-card-supply';
  const roleEl = document.createElement('span');
  roleEl.className = 'ta-card-role';
  tip.append(nameEl, time, power, costs, supplyEl, roleEl);

  root.append(face.face, tip);
  bindCardTip(root, tip);
  const handle: UnitCardHandle = {
    root, tip, nameEl, title: face.title, tierEl: face.tierEl, price: face.price, shortTime: face.shortTime,
    time, power, costs, supplyEl, roleEl, supplyReason,
    reason: null, unlockDetail: null, card, costKey: '',
  };
  root.onclick = () => {
    if (handle.card.disabled || root.disabled) return;
    onQueue(handle.card);
  };
  syncUnitCard(handle, card);
  return handle;
}

export function syncUnitCard(handle: UnitCardHandle, card: UnitCardModel): void {
  handle.card = card;
  handle.root.setAttribute('data-unit', card.unit);
  handle.root.setAttribute('data-tier', String(card.tier));
  handle.root.setAttribute('data-queue-tier', String(card.tier));
  handle.root.setAttribute('data-queue-unit', card.unit);
  if (handle.title.textContent !== card.label) handle.title.textContent = card.label;
  if (handle.nameEl.textContent !== card.label) handle.nameEl.textContent = card.label;
  const tierText = `T${card.tier}`;
  if (handle.tierEl.textContent !== tierText) handle.tierEl.textContent = tierText;
  const price = shortResourceLine(card.cost);
  if (handle.price.textContent !== price) handle.price.textContent = price;
  const timeText = `${card.buildS}s`;
  if (handle.shortTime.textContent !== timeText) handle.shortTime.textContent = timeText;
  if (handle.time.textContent !== timeText) handle.time.textContent = timeText;
  if (handle.power.textContent !== card.powerText) handle.power.textContent = card.powerText;
  const supplyText = `Supply ${card.supply}`;
  if (handle.supplyEl.textContent !== supplyText) handle.supplyEl.textContent = supplyText;
  const role = workerRole(card.unit);
  if (handle.roleEl.textContent !== role) handle.roleEl.textContent = role;
  syncUnitCosts(handle, card);
  syncUnitLock(handle, card);
}

function syncUnitCosts(handle: UnitCardHandle, card: UnitCardModel): void {
  handle.costKey = syncCostPills(handle.costs, card.costPills, 'ta-units__cost-pill', handle.costKey);
}

function syncUnitLock(handle: UnitCardHandle, card: UnitCardModel): void {
  const disabled = Boolean(card.disabled);
  handle.root.className = card.stageLocked ? 'ta-units__card plate-sm is-stage-locked' : 'ta-units__card plate-sm';
  handle.root.setAttribute('data-disabled', String(disabled));
  handle.root.setAttribute('data-unlock-stage', String(card.unlockStage));
  handle.root.disabled = disabled;
  if (card.stageLocked) applyStageLockAttrs(handle.root, card);
  else clearStageLockAttrs(handle.root);
  syncDisabledReason(handle, card, disabled);
}

function syncDisabledReason(handle: UnitCardHandle, card: UnitCardModel, disabled: boolean): void {
  if (disabled && card.disabledReason) {
    if (!handle.reason) {
      handle.reason = document.createElement('span');
      handle.reason.className = 'ta-units__reason';
      handle.tip.appendChild(handle.reason);
    }
    if (handle.reason.textContent !== card.disabledReason) handle.reason.textContent = card.disabledReason;
    syncUnlockDetail(handle, card);
    return;
  }
  handle.reason?.remove();
  handle.reason = null;
  handle.unlockDetail?.remove();
  handle.unlockDetail = null;
}

function syncUnlockDetail(handle: UnitCardHandle, card: UnitCardModel): void {
  const detail = card.unlockDetailText ?? '';
  if (!(card.stageLocked && detail && detail !== card.disabledReason)) {
    handle.unlockDetail?.remove();
    handle.unlockDetail = null;
    return;
  }
  if (!handle.unlockDetail) {
    handle.unlockDetail = document.createElement('span');
    handle.unlockDetail.className = 'ta-units__unlock-detail';
    handle.root.appendChild(handle.unlockDetail);
  }
  if (handle.unlockDetail.textContent !== detail) handle.unlockDetail.textContent = detail;
}

