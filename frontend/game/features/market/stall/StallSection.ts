import { MarketTracker } from '../analytics/marketTracker';
import type { MarketSnapshotResponse } from '@terra/contracts';
import type { FeatureContext } from '../../../core/registry/types';
import { makeDiv } from '../../shared/dom';
import { FEE_STEP_BP, amountText, bpText, clampBp, earnedRows, inventoryRows, pinnedFees, valuationRows } from './stallModel';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const line = (testid: string, left: string, right: string): HTMLElement => {
  const row = makeDiv('ta-stall__line', testid);
  row.append(el('span', 'ta-stall__k', left), el('span', 'ta-stall__v', right));
  return row;
};

const panel = (title: string, testid: string, ...body: HTMLElement[]): HTMLElement => {
  const p = makeDiv('ta-stall__panel', testid);
  p.append(el('div', 'ta-market__title', title), ...body);
  return p;
};

/**
 * Stall section of the MARKET tab (W13-22): fee slider 0..policy max, current fee, and the separate panels resource
 * inventory / estimated valuation / realized stall fees. The slider only ever sends `market.setHubFee`; it never edits an
 * order (open orders keep the stall fee pinned at placement, see `market-mirror.spec.ts` "setHubFee").
 */
const APPLIED_GRACE_MS = 8000;

export class StallSection {
  readonly el = makeDiv('ta-stall', 'market-stall');
  private snap: MarketSnapshotResponse | null = null;
  private draftBp: number | null = null;
  private busy = false;
  private message = '';
  /** The fee the host just acknowledged: the REST snapshot lags the sim event by a moment, so it wins over a stale `hubFeeBp` for a few seconds. */
  private applied: { bp: number; at: number } | null = null;

  constructor(private readonly ctx: FeatureContext, private readonly now: () => number = Date.now) {
    this.render();
  }

  apply(s: MarketSnapshotResponse): void {
    this.snap = s;
    this.render();
  }

  private currentBp(): number {
    const served = this.snap?.stall?.hubFeeBp ?? 0;
    if (this.applied && (served === this.applied.bp || this.now() - this.applied.at > APPLIED_GRACE_MS)) this.applied = null;
    return this.applied?.bp ?? served;
  }

  private async send(bp: number): Promise<void> {
    const send = this.ctx.services.sendCommand;
    if (!send || this.busy) return;
    this.busy = true;
    this.message = '';
    this.render();
    const res = await send('market.setHubFee', { bp });
    this.busy = false;
    if (res.ok) {
      new MarketTracker(this.ctx.services.track).stallFeeChanged(bp);
      this.draftBp = null;
      this.applied = { bp, at: this.now() };
      this.message = `Stall fee set to ${bpText(bp)} for new orders.`;
      const id = this.ctx.services.session?.planetId() ?? null;
      const load = this.ctx.services.marketSnapshot;
      if (id && load) { try { this.snap = await load(id); } catch { /* the next onShow repairs it */ } }
    } else {
      this.message = `Rejected: ${res.detail ?? res.code}`;
    }
    this.render();
  }

  private controls(): HTMLElement {
    const max = this.snap?.policy?.stallFeeMaxBp ?? 0;
    const cur = this.currentBp();
    const draft = this.draftBp ?? cur;
    const slider = el('input', 'ta-stall__slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(max);
    slider.step = String(FEE_STEP_BP);
    slider.value = String(draft);
    slider.disabled = !this.snap?.policy || this.busy;
    slider.dataset.testid = 'stall-slider';
    slider.setAttribute('aria-label', 'Stall fee');
    const shown = el('span', 'ta-stall__v', bpText(draft));
    shown.dataset.testid = 'stall-draft';
    const apply = el('button', 'ta-stall__apply', 'APPLY');
    apply.type = 'button';
    apply.dataset.testid = 'stall-apply';
    apply.disabled = draft === cur || !this.snap?.policy || this.busy;
    slider.addEventListener('input', () => {
      this.draftBp = clampBp(Number(slider.value), max);
      shown.textContent = bpText(this.draftBp);
      apply.disabled = this.draftBp === cur || this.busy;
    });
    apply.addEventListener('click', () => { void this.send(this.draftBp ?? cur); });
    const row = makeDiv('ta-stall__control');
    row.append(slider, shown, apply);
    const note = el('div', 'ta-market__empty', `Range 0 - ${bpText(max)}. Charged to buyers on fills at your stall; open orders keep the fee pinned when they were placed.`);
    const out = el('div', 'ta-stall__msg', this.message);
    out.dataset.testid = 'stall-message';
    const pins = pinnedFees(this.snap?.myOrders);
    const pinned = el('div', 'ta-market__empty', pins.length ? `Pinned on your open orders: ${pins.map((p) => `${bpText(p.bp)} (${p.orders})`).join(', ')}` : '');
    pinned.dataset.testid = 'stall-pinned';
    return panel('STALL FEE', 'stall-fee', line('stall-current', 'Current fee', bpText(cur)), row, note, pinned, out);
  }

  private panels(): HTMLElement[] {
    const inv = inventoryRows(this.snap);
    const invBody = inv.length
      ? inv.map((r) => line('stall-inv', r.resource, `${r.free} free${r.reserved > 0n ? ` + ${r.reserved} reserved` : ''}`))
      : [el('div', 'ta-market__empty', 'No resources in orbit.')];
    const val = valuationRows(this.snap, this.now());
    const valBody = val.length
      ? val.flatMap((r) => [line('stall-val', r.resource, r.value ? `~${r.value} (estimate)` : '—'), el('div', 'ta-stall__src', r.source)])
      : [el('div', 'ta-market__empty', '—')];
    const earned = earnedRows(this.snap);
    const earnBody = earned.length
      ? earned.map((r) => line('stall-earned', r.token, r.text))
      : [el('div', 'ta-market__empty', `No fees earned yet (${amountText('USDC', '0')}).`)];
    return [
      panel('RESOURCE INVENTORY (IN ORBIT)', 'stall-inventory', ...invBody),
      panel('ESTIMATED VALUATION', 'stall-valuation', ...valBody),
      panel('REALIZED STALL FEES', 'stall-earnings', ...earnBody),
    ];
  }

  render(): void {
    this.el.replaceChildren(this.controls(), ...this.panels());
  }

  dispose(): void { this.el.remove(); }
}
