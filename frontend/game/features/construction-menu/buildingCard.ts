import { applyStageLockAttrs, bindCardTip, clearStageLockAttrs, createMenuCardFace, shortResourceLine, syncCostPills } from '../shared/menuCards';
import { formatResourceLabel, type BuildingCardModel, type BuildingKind } from './catalog';

export interface BuildingCardRefs {
  btn: HTMLButtonElement;
  tip: HTMLElement;
  nameEl: HTMLElement;
  title: HTMLElement;
  tierEl: HTMLElement;
  price: HTMLElement;
  shortTime: HTMLElement;
  footprint: HTMLElement;
  time: HTMLElement;
  power: HTMLElement;
  costs: HTMLElement;
  costKey: string;
  reason: HTMLElement | null;
  unlockDetail: HTMLElement | null;
  card: BuildingCardModel;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createBuildingCard(
  card: BuildingCardModel,
  onActivate: (building: BuildingKind) => void,
): BuildingCardRefs {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ta-construction__card plate-sm';
  btn.setAttribute('data-building', card.building);

  const face = createMenuCardFace('ta-construction__title', card.archetype);
  const tip = document.createElement('span');
  tip.className = 'ta-card-tip';
  tip.setAttribute('role', 'tooltip');
  const nameEl = document.createElement('span');
  nameEl.className = 'ta-card-tip__name';
  const time = document.createElement('span');
  time.className = 'ta-construction__time';
  const power = document.createElement('span');
  power.className = 'ta-construction__power';
  const footprint = document.createElement('span');
  footprint.className = 'ta-construction__footprint';
  const costs = document.createElement('span');
  costs.className = 'ta-construction__costs';
  tip.append(nameEl, time, power, footprint, costs);
  btn.append(face.face, tip);
  bindCardTip(btn, tip);

  const ref: BuildingCardRefs = {
    btn, tip, nameEl, title: face.title, tierEl: face.tierEl, price: face.price, shortTime: face.shortTime,
    footprint, time, power, costs, costKey: '', reason: null, unlockDetail: null, card,
  };
  bindActivate(ref, onActivate);
  return ref;
}

function bindActivate(ref: BuildingCardRefs, onActivate: (building: BuildingKind) => void): void {
  let pointerDownAt = -Infinity;
  ref.btn.onpointerdown = (event?: PointerEvent) => {
    if (event && typeof event.button === 'number' && event.button !== 0) return;
    if (ref.card.disabled) return;
    pointerDownAt = now();
    onActivate(ref.card.building);
  };
  ref.btn.onclick = () => {
    if (now() - pointerDownAt < 400) {
      pointerDownAt = -Infinity;
      return;
    }
    if (ref.card.disabled) return;
    onActivate(ref.card.building);
  };
}

export function syncBuildingCard(ref: BuildingCardRefs, card: BuildingCardModel, selected: boolean): void {
  ref.card = card;
  ref.btn.setAttribute('data-disabled', String(card.disabled));
  ref.btn.disabled = card.disabled;
  if (selected) ref.btn.setAttribute('data-selected', 'true');
  else if (typeof ref.btn.removeAttribute === 'function') ref.btn.removeAttribute('data-selected');
  if (ref.title.textContent !== card.label) ref.title.textContent = card.label;
  if (ref.nameEl.textContent !== card.label) ref.nameEl.textContent = card.label;
  const tierText = `T${card.tier}`;
  if (ref.tierEl.textContent !== tierText) ref.tierEl.textContent = tierText;
  const price = shortResourceLine(card.cost);
  if (ref.price.textContent !== price) ref.price.textContent = price;
  if (ref.footprint.textContent !== card.footprintText) ref.footprint.textContent = card.footprintText;
  const shortTime = `${card.designBuildS}s`;
  if (ref.shortTime.textContent !== shortTime) ref.shortTime.textContent = shortTime;
  const timeText = `${card.designBuildS}s (${card.hqBuildS}s HQ)`;
  if (ref.time.textContent !== timeText) ref.time.textContent = timeText;
  if (ref.power.textContent !== card.powerText) ref.power.textContent = card.powerText;
  syncBuildingCosts(ref, card);
  syncBuildingLock(ref, card);
}

function syncBuildingCosts(ref: BuildingCardRefs, card: BuildingCardModel): void {
  const pills = Object.entries(card.cost).filter(([, amt]) => amt > 0).map(([res, amt]) => `${amt} ${formatResourceLabel(res)}`);
  ref.costKey = syncCostPills(ref.costs, pills, 'ta-construction__cost-pill', ref.costKey);
}

function syncBuildingLock(ref: BuildingCardRefs, card: BuildingCardModel): void {
  const nextClass = card.stageLocked ? 'ta-construction__card plate-sm is-stage-locked' : 'ta-construction__card plate-sm';
  if (ref.btn.className !== nextClass) ref.btn.className = nextClass;
  ref.btn.setAttribute('data-unlock-stage', String(card.unlockStage));
  if (!card.stageLocked) {
    clearBuildingLock(ref);
    syncBuildingReason(ref, card);
    return;
  }
  const detail = applyStageLockAttrs(ref.btn, card);
  if (detail && detail !== card.disabledReason) ensureUnlockDetail(ref, detail);
  else dropUnlockDetail(ref);
  syncBuildingReason(ref, card);
}

function clearBuildingLock(ref: BuildingCardRefs): void {
  clearStageLockAttrs(ref.btn);
  dropUnlockDetail(ref);
}

function ensureUnlockDetail(ref: BuildingCardRefs, detail: string): void {
  if (!ref.unlockDetail) {
    ref.unlockDetail = document.createElement('span');
    ref.unlockDetail.className = 'ta-construction__unlock-detail';
    ref.btn.appendChild(ref.unlockDetail);
  }
  if (ref.unlockDetail.textContent !== detail) ref.unlockDetail.textContent = detail;
}

function dropUnlockDetail(ref: BuildingCardRefs): void {
  ref.unlockDetail?.remove();
  ref.unlockDetail = null;
}

function syncBuildingReason(ref: BuildingCardRefs, card: BuildingCardModel): void {
  if (card.disabled && card.disabledReason) {
    if (!ref.reason) {
      ref.reason = document.createElement('span');
      ref.reason.className = 'ta-construction__reason';
      ref.tip.appendChild(ref.reason);
    }
    if (ref.reason.textContent !== card.disabledReason) ref.reason.textContent = card.disabledReason;
    return;
  }
  ref.reason?.remove();
  ref.reason = null;
}
