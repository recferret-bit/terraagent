import {
  type DiplomacyColonyView,
  type DiplomacyOfferView,
  type DiplomacyPanelActions,
  type DiplomacyTruceView,
  type TruceDurationHours,
  TRUCE_DURATIONS_HOURS,
  formatTickRemaining,
} from '../types';

export function renderIncomingOfferBanner(
  bannerEl: HTMLElement,
  offer: DiplomacyOfferView | undefined,
  currentTick: number,
  actions?: Partial<DiplomacyPanelActions>,
): void {
  const hasOffer = Boolean(offer && offer.expiresAtTick > currentTick);
  bannerEl.hidden = !hasOffer;
  bannerEl.replaceChildren();
  if (!hasOffer || !offer) return;

  const header = document.createElement('div');
  header.className = 'ta-diplomacy-offer-banner__header';

  const title = document.createElement('span');
  title.className = 'ta-diplomacy-offer-banner__title';
  title.textContent = 'INCOMING TRUCE OFFER';

  const timer = document.createElement('span');
  timer.className = 'ta-diplomacy-offer-banner__timer';
  timer.dataset.testid = 'offer-countdown';
  timer.textContent = formatTickRemaining(offer.expiresAtTick, currentTick);
  header.append(title, timer);

  const meta = document.createElement('div');
  meta.className = 'ta-diplomacy-offer-banner__meta';
  const partner = offer.fromColonyId ?? `Colony #${offer.fromColony}`;
  meta.textContent = `${partner} proposes a ${offer.hours}h bilateral truce`;

  const btns = document.createElement('div');
  btns.className = 'ta-diplomacy-offer-banner__actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.className = 'btn btn-primary btn-sm';
  acceptBtn.dataset.action = 'accept-truce';
  acceptBtn.dataset.offerId = offer.offerId;
  acceptBtn.textContent = 'Accept';
  acceptBtn.onclick = () => actions?.onRespondTruce?.(offer.offerId, true);

  const declineBtn = document.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'btn btn-ghost btn-sm';
  declineBtn.dataset.action = 'decline-truce';
  declineBtn.dataset.offerId = offer.offerId;
  declineBtn.textContent = 'Decline';
  declineBtn.onclick = () => actions?.onRespondTruce?.(offer.offerId, false);

  btns.append(acceptBtn, declineBtn);
  bannerEl.append(header, meta, btns);
}

export function buildTruceBadgeElement(
  truce: DiplomacyTruceView,
  currentTick: number,
  actions?: Partial<DiplomacyPanelActions>,
): HTMLElement {
  const badge = document.createElement('div');
  badge.className = 'ta-diplomacy-truce-badge plate-sm';
  badge.dataset.testid = 'diplomacy-truce-badge';
  badge.dataset.truceId = truce.truceId;
  badge.dataset.status = truce.status;

  const main = document.createElement('div');
  main.className = 'ta-diplomacy-truce-badge__main';

  const partner = document.createElement('span');
  partner.className = 'ta-diplomacy-truce-badge__partner';
  partner.textContent = truce.partnerColonyId ?? `Colony #${truce.partnerColony}`;

  const pill = document.createElement('span');
  pill.className = 'ta-diplomacy-truce-badge__pill';
  pill.textContent = truce.status.toUpperCase();
  main.append(partner, pill);

  const footer = document.createElement('div');
  footer.className = 'ta-diplomacy-truce-badge__footer';

  const timer = document.createElement('span');
  timer.className = 'ta-diplomacy-truce-badge__timer';
  timer.dataset.testid = 'truce-timer';

  if (truce.status === 'notice' && typeof truce.noticeEndsAtTick === 'number') {
    const noticeRem = formatTickRemaining(truce.noticeEndsAtTick, currentTick);
    timer.textContent = `Notice: ${noticeRem}`;
  } else {
    const expRem = formatTickRemaining(truce.expiresAtTick, currentTick);
    timer.textContent = expRem;
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-ghost btn-sm';
  cancelBtn.dataset.action = 'cancel-truce';
  cancelBtn.dataset.truceId = truce.truceId;
  cancelBtn.textContent = 'Cancel';
  cancelBtn.disabled = truce.status === 'notice';
  cancelBtn.onclick = () => actions?.onCancelTruce?.(truce.truceId);

  footer.append(timer, cancelBtn);
  badge.append(main, footer);
  return badge;
}

export function renderProposeTruceSection(
  proposeEl: HTMLElement,
  view: DiplomacyColonyView,
  selectedTargetColony: number,
  selectedHours: TruceDurationHours,
  onSelectTarget: (targetColony: number) => void,
  onSelectHours: (hours: TruceDurationHours) => void,
  onSubmit: () => void,
): number {
  proposeEl.replaceChildren();

  const label = document.createElement('div');
  label.className = 'ta-diplomacy-propose__label';
  label.textContent = 'PROPOSE TRUCE';

  const select = document.createElement('select');
  select.dataset.testid = 'propose-target-colony';
  select.dataset.action = 'select-target';

  const contacts = view.contacts.length > 0 ? view.contacts : [1];
  let resolvedTarget = selectedTargetColony;
  if (!contacts.includes(resolvedTarget)) {
    resolvedTarget = contacts[0] ?? 1;
  }
  for (const c of contacts) {
    if (c === view.colonyIndex) continue;
    const opt = document.createElement('option');
    opt.value = String(c);
    opt.textContent = `Colony #${c}`;
    if (c === resolvedTarget) opt.selected = true;
    select.appendChild(opt);
  }
  if (select.value) resolvedTarget = Number(select.value);
  select.onchange = () => onSelectTarget(Number(select.value));

  const chips = document.createElement('div');
  chips.className = 'ta-diplomacy-chips';

  for (const h of TRUCE_DURATIONS_HOURS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `ta-diplomacy-chip btn btn-ghost btn-sm ${h === selectedHours ? 'ta-chip--active' : ''}`;
    chip.dataset.testid = `duration-chip-${h}h`;
    chip.dataset.hours = String(h);
    chip.textContent = `${h}h`;
    chip.onclick = () => onSelectHours(h);
    chips.appendChild(chip);
  }

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'btn btn-primary btn-sm ta-diplomacy-propose__submit';
  submitBtn.dataset.action = 'propose-truce';
  submitBtn.textContent = 'Offer Truce';

  const isOathbreaker = Boolean(
    typeof view.oathbreakerUntil === 'number' && view.oathbreakerUntil > view.currentTick,
  );
  submitBtn.disabled = isOathbreaker;
  submitBtn.title = isOathbreaker ? 'Cannot propose truce while marked Oathbreaker' : 'Propose truce';
  submitBtn.onclick = onSubmit;

  proposeEl.append(label, select, chips, submitBtn);
  return resolvedTarget;
}
