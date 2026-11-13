import { formatAtomic, parsePairId, type BookLevel, type OrderSide, type PlaceTradeOrderRequest } from '@terra/contracts';
import { TradeApiFailure, type TradeClient } from '../api/client';
import { previewTicket, type TicketPreview } from '../model/preview';
import { freeOf, type TradeState } from '../model/state';
import { bpLabel, fmtAmount, fmtUnit, levelRatio, totalAtLevel, tryParse, ttlLabel } from '../model/units';
import { h, note } from './dom';

export interface TicketDeps {
  client: TradeClient;
  state(): TradeState;
  /** Called after an order was sent so the page refreshes orders / balances. */
  onSent(): void;
}

/** The order ticket keeps its own DOM (inputs must survive every state refresh); `update` redraws only the derived parts. */
export class OrderTicket {
  readonly root: HTMLElement;
  private side: OrderSide = 'sell';
  private busy = false;
  private readonly amount = h('input', { class: 'input', id: 'tk-amount', 'data-testid': 'ticket-amount', inputmode: 'numeric', autocomplete: 'off', placeholder: 'whole units', 'aria-describedby': 'tk-reason' });
  private readonly unitPrice = h('input', { class: 'input', id: 'tk-unit-price', 'data-testid': 'ticket-unit-price', inputmode: 'decimal', autocomplete: 'off', placeholder: 'price per 1 unit (auto-syncs total)' });
  private readonly total = h('input', { class: 'input', id: 'tk-total', 'data-testid': 'ticket-total', inputmode: 'decimal', autocomplete: 'off', placeholder: 'total for the whole amount', 'aria-describedby': 'tk-reason' });
  private readonly feeTier = h('div', { class: 'tr-fee-tier', 'data-testid': 'ticket-fee-tier' });
  private readonly ttl = h('select', { class: 'input', id: 'tk-ttl' });
  private readonly stall = h('input', { class: 'input', id: 'tk-stall', 'data-testid': 'ticket-stall', inputmode: 'decimal', autocomplete: 'off' });
  private readonly stallField = h('div', { class: 'field' });
  private readonly unit = h('p', { class: 'tr-hint', id: 'tk-unit' });
  private readonly preview = h('dl', { class: 'tr-dl', id: 'tk-preview', 'data-testid': 'ticket-preview' });
  private readonly reason = h('p', { class: 'tr-note tr-note-warn', id: 'tk-reason', 'data-testid': 'ticket-reason', role: 'status' });
  private readonly result = h('div', { class: 'tr-result', 'data-testid': 'ticket-result', 'aria-live': 'polite' });
  private readonly place = h('button', { type: 'button', class: 'btn btn-primary', id: 'tk-place', 'data-testid': 'ticket-place' }, 'PLACE ORDER');
  private readonly sideBtns: Record<OrderSide, HTMLButtonElement>;
  private readonly policyNote = h('p', { class: 'tr-hint' });
  private readonly cost = h('input', { class: 'input', id: 'tk-cost', 'data-testid': 'ticket-cost', inputmode: 'decimal', autocomplete: 'off', placeholder: 'optional, per unit' });
  private suggestMsg = h('div', { class: 'tr-suggest', 'data-testid': 'ticket-suggest-msg', 'aria-live': 'polite' });
  private ttlKey = '';

  constructor(private readonly d: TicketDeps) {
    const mk = (s: OrderSide): HTMLButtonElement => h('button', { type: 'button', class: `tr-side tr-side-${s}`, 'data-side': s, 'data-testid': `ticket-side-${s}`, role: 'radio', onclick: () => this.setSide(s) }, s.toUpperCase());
    this.sideBtns = { buy: mk('buy'), sell: mk('sell') };
    for (const el of [this.amount, this.total, this.stall]) el.addEventListener('input', () => this.update());
    this.unitPrice.addEventListener('input', () => this.syncTotalFromUnitPrice());
    this.ttl.addEventListener('change', () => this.update());
    this.place.addEventListener('click', () => { void this.submit(); });
    const suggest = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'tk-suggest', 'data-testid': 'ticket-suggest', title: 'Agent-assisted: asks the quote engine for a price and amount, only fills the form' }, 'SUGGEST');
    suggest.addEventListener('click', () => { void this.suggest(); });
    this.stallField.append(h('label', { class: 'field-label', for: 'tk-stall' }, 'MAX STALL FEE (%)'), this.stall, h('span', { class: 'field-hint' }, 'Buy only: the most you accept the seller\'s Trade Hub to charge (0–1.00% paid to seller\'s Hub). Reserved up front.'));
    this.root = h('div', { class: 'tr-ticket' },
      this.feeTier,
      h('div', { class: 'tr-sides', role: 'radiogroup', 'aria-label': 'Order side' }, this.sideBtns.buy, this.sideBtns.sell),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'tk-amount' }, 'AMOUNT (UNITS)'), this.amount),
      h('div', { class: 'tr-price-pair' },
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'tk-unit-price' }, 'UNIT PRICE (PER 1 UNIT)'), this.unitPrice),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'tk-total' }, 'TOTAL ORDER PRICE'), this.total)),
      this.unit,
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'tk-ttl' }, 'EXPIRES IN'), this.ttl),
      this.stallField, this.aonToggle(), this.policyNote, this.preview, this.reason,
      h('div', { class: 'tr-row' }, this.place, suggest), h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'tk-cost' }, 'SUGGEST: YOUR UNIT COST'), this.cost, h('span', { class: 'field-hint' }, 'What one unit costs you; the quote engine needs it to price an ask.')), this.suggestMsg, this.result);
    this.setSide('sell');
  }

  /** All-or-nothing is in the request contract, but the backend accepts only `partial` today (`all_or_nothing` answers 400 `invalid_request`). */
  private aonToggle(): HTMLElement {
    const tip = 'All-or-nothing is not supported yet: the market accepts only partial fills today. Your order may fill in several lots.';
    return h('label', { class: 'tr-check tr-aon', id: 'tk-aon-label', title: tip },
      h('input', { type: 'checkbox', id: 'tk-aon', disabled: true, 'aria-describedby': 'tk-aon-hint' }), ' ALL-OR-NOTHING ',
      h('span', { class: 'tr-hint', id: 'tk-aon-hint' }, '(not supported yet: partial fills only)'));
  }

  private setSide(s: OrderSide): void {
    this.side = s;
    for (const [k, b] of Object.entries(this.sideBtns)) { b.classList.toggle('is-on', k === s); b.setAttribute('aria-checked', String(k === s)); }
    this.stallField.hidden = s === 'sell';
    this.update();
  }

  /** A ladder click: take the clicked level (buy against an ask, sell into a bid); amount defaults to the level's size. */
  prefillFromLevel(level: BookLevel, takerSide: OrderSide): void {
    const st = this.d.state();
    const q = parsePairId(st.pair)?.quote;
    if (!q) return;
    this.setSide(takerSide);
    const units = Number(this.amount.value.trim()) > 0 && /^\d+$/.test(this.amount.value.trim()) ? Number(this.amount.value.trim()) : level.amount;
    this.amount.value = String(units);
    this.total.value = formatAtomic(q, totalAtLevel(levelRatio(level), units, takerSide === 'buy' ? 'up' : 'down'));
    this.update();
    this.total.focus();
  }

  private stallBp(st: TradeState): number {
    const max = st.policy?.stallFeeMaxBp ?? 0;
    const txt = this.stall.value.trim();
    if (txt === '') return st.policy?.stallFeeDefaultBp ?? 0;
    const v = Math.round(Number(txt) * 100);
    return Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0;
  }

  /** Redraws options, preview and the disabled reason from the current state and inputs. */
  update(): void {
    const st = this.d.state();
    const parsed = parsePairId(st.pair);
    if (!parsed) return;
    const opts = st.policy?.ttlOptionsS ?? [];
    const key = opts.join(',');
    if (key !== this.ttlKey) {
      this.ttlKey = key;
      const keep = this.ttl.value;
      this.ttl.replaceChildren(...opts.map((s) => h('option', { value: String(s) }, ttlLabel(s))));
      if (keep && opts.includes(Number(keep))) this.ttl.value = keep;
      else if (opts.includes(3600)) this.ttl.value = '3600';
      if (!this.stall.value && st.policy) this.stall.placeholder = `${(st.policy.stallFeeDefaultBp / 100).toFixed(2)} (default), max ${(st.policy.stallFeeMaxBp / 100).toFixed(2)}`;
    }
    const q = parsed.quote;
    const pv = previewTicket({
      side: this.side, base: parsed.base, quote: q, amountText: this.amount.value, totalText: this.total.value, stallBp: this.stallBp(st), policy: st.policy,
      freeQuote: freeOf(st.balances, q), freeUnits: freeOf(st.balances, parsed.base), hasColony: st.balances !== null, busy: this.busy,
    });
    if (document.activeElement !== this.unitPrice) {
      this.unitPrice.value = pv.amount && pv.total ? fmtUnit({ num: pv.total.toString(), den: pv.amount }, q) : '';
    }
    const feeBp = st.policy?.platformFeeBp ?? 100;
    const isStaker = feeBp <= 50;
    this.feeTier.className = `tr-fee-tier ${isStaker ? 'is-staker' : ''}`;
    this.feeTier.textContent = isStaker
      ? `★ STAKER PERK ACTIVE: ${(feeBp / 100).toFixed(2)}% Platform Fee (50% Discount — ≥10 NEAR Staked)`
      : `Platform Fee: ${(feeBp / 100).toFixed(2)}% (Stake ≥10 NEAR in Colony Staking for 0.50% Fee + Managed NEAR.AI)`;
    this.drawPreview(pv, q, parsed.base, st);
    this.unit.textContent = pv.amount && pv.total ? `= ${fmtUnit({ num: pv.total.toString(), den: pv.amount }, q)} ${q} per unit · Total ${formatAtomic(q, pv.total)} ${q} settled via NEP-413` : 'Type either Unit Price or Total Order Price — the other updates automatically.';
    this.reason.hidden = pv.blocked === null || this.busy;
    this.reason.textContent = pv.blocked ?? '';
    this.place.disabled = pv.blocked !== null;
    this.place.title = pv.blocked ?? '';
    const lastPolicy = st.orders[0]?.fillPolicy;
    this.policyNote.textContent = `Orders are sent with the partial fill policy${lastPolicy ? ` (your last order: ${lastPolicy.replace(/_/g, ' ')})` : ''}.`;
  }

  private syncTotalFromUnitPrice(): void {
    const st = this.d.state();
    const parsed = parsePairId(st.pair);
    if (!parsed) return;
    const units = Number(this.amount.value.trim());
    const perUnit = tryParse(parsed.quote, this.unitPrice.value);
    if (Number.isInteger(units) && units > 0 && perUnit !== null) {
      this.total.value = formatAtomic(parsed.quote, perUnit * BigInt(units));
    }
    this.update();
  }

  private drawPreview(pv: TicketPreview, q: Parameters<typeof fmtAmount>[0], base: string, st: TradeState): void {
    const row = (k: string, v: string, id: string): HTMLElement[] => [h('dt', {}, k), h('dd', { class: 'num', 'data-k': id, 'data-testid': `ticket-preview-${id}` }, v)];
    const money = (v: bigint | null): string => (v === null ? '-' : fmtAmount(q, v));
    const min = st.policy?.minNotional[q];
    const unitStr = pv.amount && pv.total ? `${fmtUnit({ num: pv.total.toString(), den: pv.amount }, q)} ${q}` : '-';
    const daoCut = pv.total === null ? null : (pv.platformFee * 2_000n) / 10_000n;
    const protocolCut = pv.total === null ? null : pv.platformFee - (daoCut ?? 0n);
    const rows = this.side === 'buy'
      ? [
          ...row('UNIT PRICE', unitStr, 'unit-price'),
          ...row('SELLER PRINCIPAL', money(pv.total), 'notional'),
          ...row('PLATFORM FEE', money(pv.total === null ? null : pv.platformFee), 'platform'),
          ...row('↳ PLANET DAO (20%)', money(daoCut), 'split-dao'),
          ...row('↳ TERRAAGENT PROTOCOL (80%)', money(protocolCut), 'split-protocol'),
          ...row('MAX STALL OWNER FEE', money(pv.total === null ? null : pv.stallFee), 'stall'),
          ...row('MAX SPEND (RESERVED)', money(pv.total === null ? null : pv.maxSpend), 'max'),
        ]
      : [
          ...row('UNIT PRICE', unitStr, 'unit-price'),
          ...row('YOU GIVE (NEP-245)', pv.amount === null ? '-' : `${pv.amount} ${base}`, 'give'),
          ...row('YOU RECEIVE (100%)', money(pv.youReceive), 'receive'),
          ...row('FEES', 'paid by the buyer, none for you (+ your Stall Fee on hub sales)', 'fees'),
        ];
    if (min) rows.push(...row('MIN NOTIONAL', fmtAmount(q, min), 'min'));
    this.preview.replaceChildren(...rows);
  }

  private async submit(): Promise<void> {
    const st = this.d.state();
    const parsed = parsePairId(st.pair);
    if (!parsed || this.busy) return;
    const amount = Number(this.amount.value.trim());
    const req: PlaceTradeOrderRequest = {
      planetId: st.planetId, side: this.side, resource: parsed.base, amount,
      price: { token: parsed.quote, amount: (tryParse(parsed.quote, this.total.value) ?? 0n).toString() },
      ttlS: Number(this.ttl.value), fillPolicy: 'partial',
      ...(this.side === 'buy' ? { maxStallFeeBp: this.stallBp(st) } : {}),
    };
    this.busy = true;
    this.update();
    this.result.replaceChildren();
    try {
      const res = await this.d.client.place(req);
      const kind = res.status === 'rejected' ? 'err' : res.status === 'pending' ? 'warn' : 'info';
      const text = res.status === 'rejected' ? `Rejected: ${res.error?.code ?? 'unknown'}${res.error?.message ? ` - ${res.error.message}` : ''}`
        : res.status === 'pending' ? 'Sent to the sim; the outcome is not known yet. It will appear under My orders.'
          : `Order ${res.order?.orderId.slice(-8) ?? ''} accepted (${res.order?.state ?? 'OPEN'}${res.order && res.order.filled > 0 ? `, filled ${res.order.filled}/${res.order.amount}` : ''}).`;
      this.result.replaceChildren(note(text, kind));
    } catch (err) {
      this.result.replaceChildren(note(err instanceof TradeApiFailure ? `${err.code}: ${err.message}` : 'Could not send the order.', 'err'));
    } finally {
      this.busy = false;
      this.update();
      this.d.onSent();
    }
  }

  private async suggest(): Promise<void> {
    const st = this.d.state();
    const parsed = parsePairId(st.pair);
    if (!parsed || (parsed.quote !== 'USDC' && parsed.quote !== 'NEAR')) { this.suggestMsg.replaceChildren(note('Suggestions need a USDC or NEAR quote.', 'warn')); return; }
    this.suggestMsg.replaceChildren(note('Asking the quote engine...'));
    try {
      const cost = this.cost.value.trim() ? tryParse(parsed.quote, this.cost.value) : null;
      const query: Record<string, string> = { planetId: st.planetId, resource: parsed.base, quote: parsed.quote, ttlS: this.ttl.value || '3600', transportPerUnit: '0' };
      if (cost !== null) query.ownUnitCost = cost.toString();
      const q = await this.d.client.agentQuote(query);
      const side = this.side === 'buy' ? q.bid : q.ask;
      const reasons = this.side === 'buy' ? q.bidReasons : q.askReasons;
      if (!side) { this.suggestMsg.replaceChildren(note(`No ${this.side} suggestion: ${reasons.join(', ') || 'none available'}.`, 'warn')); return; }
      this.amount.value = String(side.order.amount);
      this.total.value = formatAtomic(parsed.quote, side.order.price.amount);
      if (side.order.ttlS && [...this.ttl.options].some((o) => o.value === String(side.order.ttlS))) this.ttl.value = String(side.order.ttlS);
      this.update();
      this.suggestMsg.replaceChildren(note(`Prefilled from the ${q.basis ?? 'quote'} basis: ${side.order.amount} units for ${fmtAmount(parsed.quote, side.order.price.amount)}${side.order.maxStallFeeBp !== undefined ? `, stall fee up to ${bpLabel(side.order.maxStallFeeBp)}` : ''}. Review it, then place.`));
    } catch (err) {
      this.suggestMsg.replaceChildren(note(err instanceof TradeApiFailure ? `${err.code}: ${err.message}` : 'The quote engine is not reachable.', 'err'));
    }
  }
}
