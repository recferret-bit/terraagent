import { formatAtomic, mockLabel, type GuildOffer } from '@terra/contracts';
import type { FeatureContext, TradeHubTabInstance } from '../../core/registry/types';
import { formatRejectToast } from '../shared/rejectText';
import { makeBtn, makeDiv, makeSpan } from '../shared/dom';
import { GuildAnalytics } from '../shared/guildAnalytics';
import { resourceLabel } from '../shared/resources';
import { formatDepartCountdown } from './countdown';
import { type GuildVisit, type GuildVisitModel } from './model';

const lineOf = (o: GuildOffer): string => {
  const side = o.action === 'buy' ? 'BUY' : 'SELL';
  const price = `${formatAtomic(o.price.token, o.price.amount)} ${mockLabel(o.price.token)}`;
  const reason = o.reason ? ` — ${o.reason}` : '';
  return `${side} ${o.amount} ${resourceLabel(o.resource)} · ${price}${reason}`;
};

function offerRow(o: GuildOffer, disabled: boolean, onAccept: (id: string) => void): HTMLElement {
  const row = makeDiv('ta-guild__row', 'guild-offer');
  row.dataset.offerId = o.offerId;
  const btn = makeBtn('btn btn-primary btn-sm ta-guild__accept', 'guild-accept', 'Accept', () => onAccept(o.offerId));
  btn.dataset.offerId = o.offerId;
  btn.disabled = disabled;
  row.append(makeSpan('ta-guild__line', undefined, lineOf(o)), btn);
  return row;
}

/**
 * Guild tab body: up to 6 offers, a depart countdown, and one Accept per offer.
 * A signed trade still toasts from the Contracts list; this view only shows a reject.
 */
export class GuildOffers implements TradeHubTabInstance {
  private readonly countdownEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly rejectEl: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly off: () => void;
  private readonly analytics: GuildAnalytics;

  constructor(
    private readonly root: HTMLElement,
    private readonly ctx: FeatureContext,
    private readonly model: GuildVisitModel,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.root.classList.add('ta-guild');
    this.countdownEl = makeDiv('ta-guild__countdown', 'guild-countdown');
    this.listEl = makeDiv('ta-guild__list', 'guild-offers');
    this.rejectEl = makeDiv('ta-guild__reject', 'guild-reject');
    this.analytics = new GuildAnalytics(ctx.services.track, () => ctx.flags.has('W15'));
    this.root.append(makeDiv('label ta-guild__title', undefined, 'GUILD OFFERS'), this.countdownEl, this.listEl, this.rejectEl);
    this.off = model.onChange(() => this.paint());
    this.paint();
  }

  onShow(): void {
    this.paint();
    if (this.timer) return;
    this.timer = setInterval(() => this.paint(), 1000);
  }

  onHide(): void {
    this.clearTimer();
  }

  dispose(): void {
    this.clearTimer();
    this.off();
    this.root.replaceChildren();
  }

  private paint(): void {
    const visit = this.model.visit;
    const gone = this.departed(visit);
    this.countdownEl.hidden = !visit;
    this.countdownEl.dataset.departed = String(gone);
    this.countdownEl.textContent = visit ? `${visit.name} · ${this.clock(visit)}` : '';
    const offers = visit?.offers ?? [];
    this.listEl.replaceChildren(...(offers.length
      ? offers.map((o) => offerRow(o, gone || this.model.sent.has(o.offerId), (id) => this.accept(id)))
      : [makeDiv('ta-guild__empty', 'guild-empty', 'No offers')]));
    this.rejectEl.hidden = this.model.rejectText === '';
    this.rejectEl.textContent = this.model.rejectText;
  }

  private clock(visit: GuildVisit): string {
    return visit.left ? 'Departed' : formatDepartCountdown(visit.departAt, this.now());
  }

  private departed(visit: GuildVisit | null): boolean {
    return !!visit && (visit.left || this.now() >= visit.departAt);
  }

  private accept(offerId: string): void {
    if (this.departed(this.model.visit) || !this.model.markSent(offerId)) return;
    void this.send(offerId, this.model.generation);
  }

  private async send(offerId: string, generation: number): Promise<void> {
    const send = this.ctx.services.sendCommand;
    if (!send) return;
    this.analytics.offerAccepted(offerId);
    const result = await send('market.acceptGuildOffer', { offerId });
    if (generation !== this.model.generation) return;
    if (result.ok) this.model.clearReject();
    else this.model.setReject(formatRejectToast(result.code, result.detail, 'market.acceptGuildOffer'));
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
