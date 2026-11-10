import {
  type DiplomacyColonyView,
  type DiplomacyOfferView,
  type DiplomacyPanelOptions,
  type DiplomacyTruceView,
  type TruceDurationHours,
  TRUCE_DURATIONS_HOURS,
  applyDiplomacySimEvent,
  extractDiplomacyColonyView,
  formatCountdownSeconds,
  formatTickRemaining,
} from './types';
import './diplomacy.css';

export interface DiplomacyPanelInstance {
  readonly root: HTMLElement;
  update(snapshotOrView: unknown): void;
  ingestSimEvents(events: readonly { kind: string; data?: Record<string, unknown> }[]): void;
  dispose(): void;
}

export class DiplomacyPanel implements DiplomacyPanelInstance {
  readonly root: HTMLElement;
  private readonly oathbreakerEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private readonly trucesEl: HTMLElement;
  private readonly proposeEl: HTMLElement;

  private currentView: DiplomacyColonyView;
  private selectedHours: TruceDurationHours = 6;
  private selectedTargetColony: number = 1;
  private readonly opts: DiplomacyPanelOptions;

  constructor(host: HTMLElement, options: DiplomacyPanelOptions = {}) {
    this.opts = options;
    this.currentView = extractDiplomacyColonyView(null, options.ownColonyIndex ?? 0);

    this.root = document.createElement('section');
    this.root.className = 'ta-diplomacy-panel plate-sm';
    this.root.dataset.testid = 'diplomacy-panel';

    const header = document.createElement('div');
    header.className = 'ta-diplomacy__header';
    const title = document.createElement('h3');
    title.className = 'ta-diplomacy__title';
    title.textContent = 'DIPLOMACY';
    header.appendChild(title);

    this.oathbreakerEl = document.createElement('div');
    this.oathbreakerEl.className = 'ta-diplomacy-oathbreaker';
    this.oathbreakerEl.dataset.testid = 'diplomacy-oathbreaker';
    this.oathbreakerEl.hidden = true;

    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'ta-diplomacy-offer-banner plate-sm';
    this.bannerEl.dataset.testid = 'diplomacy-offer-banner';
    this.bannerEl.hidden = true;

    this.trucesEl = document.createElement('div');
    this.trucesEl.className = 'ta-diplomacy-truces';
    this.trucesEl.dataset.testid = 'diplomacy-truces';

    this.proposeEl = document.createElement('div');
    this.proposeEl.className = 'ta-diplomacy-propose';
    this.proposeEl.dataset.testid = 'diplomacy-propose-section';

    this.root.append(header, this.oathbreakerEl, this.bannerEl, this.trucesEl, this.proposeEl);
    host.appendChild(this.root);

    this.render();
  }

  update(snapshotOrView: unknown): void {
    if (snapshotOrView && typeof snapshotOrView === 'object' && 'incomingOffers' in snapshotOrView) {
      this.currentView = snapshotOrView as DiplomacyColonyView;
    } else {
      this.currentView = extractDiplomacyColonyView(
        snapshotOrView,
        this.opts.ownColonyIndex ?? 0,
        this.currentView.currentTick,
      );
    }
    this.render();
  }

  ingestSimEvents(events: readonly { kind: string; data?: Record<string, unknown> }[]): void {
    let view = this.currentView;
    for (const ev of events) {
      view = applyDiplomacySimEvent(view, ev, this.opts.ownColonyIndex ?? 0);
    }
    this.currentView = view;
    this.render();
  }

  dispose(): void {
    this.root.remove();
  }

  private render(): void {
    this.renderOathbreaker();
    this.renderOfferBanner();
    this.renderTruces();
    this.renderPropose();
  }

  private renderOathbreaker(): void {
    const oathUntil = this.currentView.oathbreakerUntil;
    const isOathbreaker = typeof oathUntil === 'number' && oathUntil > this.currentView.currentTick;
    this.oathbreakerEl.hidden = !isOathbreaker;
    if (!isOathbreaker || oathUntil === null) {
      this.oathbreakerEl.textContent = '';
      return;
    }
    const rem = formatTickRemaining(oathUntil, this.currentView.currentTick);
    this.oathbreakerEl.textContent = `⚠ OATHBREAKER (${rem})`;
  }

  private renderOfferBanner(): void {
    const offer = this.currentView.incomingOffers[0];
    const hasOffer = Boolean(offer && offer.expiresAtTick > this.currentView.currentTick);
    this.bannerEl.hidden = !hasOffer;
    this.bannerEl.replaceChildren();
    if (!hasOffer || !offer) return;

    const header = document.createElement('div');
    header.className = 'ta-diplomacy-offer-banner__header';

    const title = document.createElement('span');
    title.className = 'ta-diplomacy-offer-banner__title';
    title.textContent = 'INCOMING TRUCE OFFER';

    const timer = document.createElement('span');
    timer.className = 'ta-diplomacy-offer-banner__timer';
    timer.dataset.testid = 'offer-countdown';
    timer.textContent = formatTickRemaining(offer.expiresAtTick, this.currentView.currentTick);
    header.append(title, timer);

    const meta = document.createElement('div');
    meta.className = 'ta-diplomacy-offer-banner__meta';
    const partner = offer.fromColonyId ?? `Colony #${offer.fromColony}`;
    meta.textContent = `${partner} proposes a ${offer.hours}h bilateral truce`;

    const actions = document.createElement('div');
    actions.className = 'ta-diplomacy-offer-banner__actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'btn btn-primary btn-sm';
    acceptBtn.dataset.action = 'accept-truce';
    acceptBtn.dataset.offerId = offer.offerId;
    acceptBtn.textContent = 'Accept';
    acceptBtn.onclick = () => this.opts.actions?.onRespondTruce?.(offer.offerId, true);

    const declineBtn = document.createElement('button');
    declineBtn.type = 'button';
    declineBtn.className = 'btn btn-ghost btn-sm';
    declineBtn.dataset.action = 'decline-truce';
    declineBtn.dataset.offerId = offer.offerId;
    declineBtn.textContent = 'Decline';
    declineBtn.onclick = () => this.opts.actions?.onRespondTruce?.(offer.offerId, false);

    actions.append(acceptBtn, declineBtn);
    this.bannerEl.append(header, meta, actions);
  }

  private renderTruces(): void {
    this.trucesEl.replaceChildren();
    const activeTruces = this.currentView.truces.filter(
      (t) => t.status !== 'ended' && t.expiresAtTick > this.currentView.currentTick,
    );

    for (const truce of activeTruces) {
      this.trucesEl.appendChild(this.buildTruceBadge(truce));
    }
  }

  private buildTruceBadge(truce: DiplomacyTruceView): HTMLElement {
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
      const noticeRem = formatTickRemaining(truce.noticeEndsAtTick, this.currentView.currentTick);
      timer.textContent = `Notice: ${noticeRem}`;
    } else {
      const expRem = formatTickRemaining(truce.expiresAtTick, this.currentView.currentTick);
      timer.textContent = expRem;
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.dataset.action = 'cancel-truce';
    cancelBtn.dataset.truceId = truce.truceId;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.disabled = truce.status === 'notice';
    cancelBtn.onclick = () => this.opts.actions?.onCancelTruce?.(truce.truceId);

    footer.append(timer, cancelBtn);
    badge.append(main, footer);
    return badge;
  }

  private renderPropose(): void {
    this.proposeEl.replaceChildren();

    const label = document.createElement('div');
    label.className = 'ta-diplomacy-propose__label';
    label.textContent = 'PROPOSE TRUCE';

    const select = document.createElement('select');
    select.dataset.testid = 'propose-target-colony';
    select.dataset.action = 'select-target';

    const contacts = this.currentView.contacts.length > 0 ? this.currentView.contacts : [1];
    if (!contacts.includes(this.selectedTargetColony)) {
      this.selectedTargetColony = contacts[0] ?? 1;
    }
    for (const c of contacts) {
      if (c === this.currentView.colonyIndex) continue;
      const opt = document.createElement('option');
      opt.value = String(c);
      opt.textContent = `Colony #${c}`;
      if (c === this.selectedTargetColony) opt.selected = true;
      select.appendChild(opt);
    }
    if (select.value) this.selectedTargetColony = Number(select.value);
    select.onchange = () => {
      this.selectedTargetColony = Number(select.value);
    };

    const chips = document.createElement('div');
    chips.className = 'ta-diplomacy-chips';

    for (const h of TRUCE_DURATIONS_HOURS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `ta-diplomacy-chip btn btn-ghost btn-sm ${h === this.selectedHours ? 'ta-chip--active' : ''}`;
      chip.dataset.testid = `duration-chip-${h}h`;
      chip.dataset.hours = String(h);
      chip.textContent = `${h}h`;
      chip.onclick = () => {
        this.selectedHours = h;
        this.renderPropose();
      };
      chips.appendChild(chip);
    }

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'btn btn-primary btn-sm ta-diplomacy-propose__submit';
    submitBtn.dataset.action = 'propose-truce';
    submitBtn.textContent = 'Offer Truce';

    const isOathbreaker = Boolean(
      typeof this.currentView.oathbreakerUntil === 'number' &&
      this.currentView.oathbreakerUntil > this.currentView.currentTick,
    );
    submitBtn.disabled = isOathbreaker;
    submitBtn.title = isOathbreaker ? 'Cannot propose truce while marked Oathbreaker' : 'Propose truce';

    submitBtn.onclick = () => {
      this.opts.actions?.onProposeTruce?.(this.selectedTargetColony, this.selectedHours);
    };

    this.proposeEl.append(label, select, chips, submitBtn);
  }
}

export function createDiplomacyPanel(
  host: HTMLElement,
  options?: DiplomacyPanelOptions,
): DiplomacyPanelInstance {
  return new DiplomacyPanel(host, options);
}
