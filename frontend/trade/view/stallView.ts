import type { TradeStallResponse } from '@terra/contracts';
import { TradeApiFailure, type TradeClient } from '../api/client';
import { earnedLines, parseFeePercent, stallErrorText, stallLockReason } from '../model/stall';
import type { TradeState } from '../model/state';
import { bpLabel } from '../model/units';
import { h, note } from './dom';

export interface StallDeps { client: TradeClient; token: string; onSaved(stall: TradeStallResponse): void }

/**
 * Stall fee editor (`PUT /v1/trade/stall`): slider + percent field bounded by the policy range, APPLY, earned fees per token and the
 * outcome message. The root element lives as long as the page, so a half-typed value survives the panel's re-renders.
 */
export class StallEditor {
  readonly root: HTMLElement;
  private readonly slider = h('input', { type: 'range', id: 'stall-range', min: 0, max: 100, step: 1, 'aria-label': 'Stall fee slider' });
  private readonly pct = h('input', { class: 'input tr-pct', id: 'stall-pct', 'data-testid': 'stall-pct', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'stall-hint' });
  private readonly apply = h('button', { type: 'submit', class: 'btn btn-primary btn-sm', id: 'stall-apply', 'data-testid': 'stall-apply' }, 'APPLY');
  private readonly current = h('b', { 'data-stall-current': '', 'data-testid': 'stall-current' });
  private readonly hint = h('span', { class: 'tr-hint', id: 'stall-hint' });
  private readonly earned = h('p', { class: 'tr-hint', 'data-stall-earned': '', 'data-testid': 'stall-earned' });
  private readonly lock = h('p', { class: 'tr-note tr-note-warn', role: 'status', 'data-stall-lock': '' });
  private readonly msg = h('div', { 'data-stall-msg': '', 'data-testid': 'stall-msg', 'aria-live': 'polite' });
  private dirty = false;
  private busy = false;
  private stall: TradeStallResponse | null = null;

  constructor(private readonly d: StallDeps) {
    this.slider.addEventListener('input', () => { this.dirty = true; this.pct.value = (Number(this.slider.value) / 100).toFixed(2); });
    this.pct.addEventListener('input', () => {
      this.dirty = true;
      const r = this.stall ? parseFeePercent(this.pct.value, this.stall.minBp, this.stall.maxBp) : null;
      if (r && 'bp' in r) this.slider.value = String(r.bp);
    });
    const form = h('form', { class: 'tr-stall-form', id: 'stall-form', novalidate: true },
      h('label', { class: 'field-label', for: 'stall-pct' }, 'STALL FEE (%)'),
      h('div', { class: 'tr-row' }, this.slider, this.pct, this.apply),
      this.hint);
    form.addEventListener('submit', (e) => { e.preventDefault(); void this.submit(); });
    this.root = h('div', { class: 'tr-stall', 'data-stall-editor': '' },
      h('h3', { class: 'tr-h3' }, 'Trade Hub Stall Owner Fee (Income Lane #2)'),
      h('p', { class: 'tr-hint' }, 'Paid directly to YOU by buyers filling against your orbital cargo (0–1.00%). Current rate: ', this.current, '. Existing open orders keep their placed rate.'),
      form, this.lock, this.msg, this.earned);
  }

  /** Redraws from state; never overwrites an unapplied edit. */
  update(s: TradeState): void {
    this.stall = s.stall;
    const st = s.stall;
    const reason = stallLockReason(this.d.token, st);
    this.lock.hidden = reason === null;
    this.lock.textContent = reason ?? '';
    for (const el of [this.slider, this.pct]) el.disabled = reason !== null;
    this.apply.disabled = reason !== null || this.busy;
    if (this.apply.disabled && reason) this.apply.title = reason; else this.apply.removeAttribute('title');
    if (!st) { this.current.textContent = 'n/a'; this.hint.textContent = ''; this.earned.textContent = ''; return; }
    this.slider.min = String(st.minBp);
    this.slider.max = String(st.maxBp);
    this.current.textContent = bpLabel(st.hubFeeBp);
    this.hint.textContent = `Allowed ${bpLabel(st.minBp)} to ${bpLabel(st.maxBp)} (default ${bpLabel(st.defaultBp)}).`;
    const lines = earnedLines(st.earned);
    this.earned.textContent = `Stall fees earned: ${lines.length ? lines.join(', ') : 'nothing yet'}.`;
    if (!this.dirty) { this.slider.value = String(st.hubFeeBp); this.pct.value = (st.hubFeeBp / 100).toFixed(2); }
  }

  private show(text: string, kind: 'info' | 'err'): void { this.msg.replaceChildren(note(text, kind)); }

  private async submit(): Promise<void> {
    const st = this.stall;
    if (!st || this.busy || stallLockReason(this.d.token, st)) return;
    const r = parseFeePercent(this.pct.value, st.minBp, st.maxBp);
    if ('error' in r) { this.show(r.error, 'err'); return; }
    this.busy = true;
    this.apply.disabled = true;
    try {
      const saved = await this.d.client.setStall(st.planetId, r.bp);
      this.dirty = false;
      this.d.onSaved(saved);
      this.show(`Stall fee set to ${bpLabel(saved.hubFeeBp)}.`, 'info');
    } catch (err) {
      this.show(err instanceof TradeApiFailure ? stallErrorText(err.code, err.details) : stallErrorText('network'), 'err');
    } finally {
      this.busy = false;
      this.apply.disabled = stallLockReason(this.d.token, this.stall) !== null;
    }
  }
}
