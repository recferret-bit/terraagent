import { TRADE_SCOPES, type CreateTradeKeyRequest, type CreateTradeKeyResponse, type TradeKeyView, type TradeScope } from '@terra/contracts';
import { TradeApiFailure, type TradeClient } from '../api/client';
import type { TradeState } from '../model/state';
import { fmtAmount, tryParse } from '../model/units';
import { badge, copyText, gate, h, note, table, td, fill } from './dom';

export interface KeysDeps { client: TradeClient; state(): TradeState; reload(): void }

/** Bot / API keys panel: create (secret shown once), kill switch, revoke, allowance and last use. */
export class KeysPanel {
  private secret: CreateTradeKeyResponse | null = null;
  private message: HTMLElement | null = null;
  private confirm: string | null = null;
  private form: HTMLFormElement | null = null;

  constructor(private readonly body: HTMLElement, private readonly d: KeysDeps) {}

  render(): void {
    const s = this.d.state();
    if (!gate(this.body, s.panels.keys, null)) return;
    const rows = s.keys.map((k) => this.row(k));
    fill(this.body,
      this.secret ? this.secretBox(this.secret) : null,
      this.message,
      rows.length ? table([{ label: 'LABEL' }, { label: 'SCOPES' }, { label: 'STATE' }, { label: 'ALLOWANCE (mock USDC / UTC day)' }, { label: 'LAST USED' }, { label: '' }], rows, 'API keys')
        : h('p', { class: 'tr-note' }, 'No API keys yet. Create one below to let a bot trade for this colony within a hard allowance.'),
      this.createForm(s));
  }

  private row(k: TradeKeyView): HTMLElement {
    const a = k.allowance;
    const revoked = k.revokedAtMs !== null;
    const state = revoked ? badge('REVOKED', 'dim') : a.killSwitch ? badge('KILL SWITCH ON', 'err') : badge('ACTIVE', 'ok');
    const act = revoked ? null : [
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-kill': k.keyId, onclick: () => { void this.run(() => this.d.client.allowance(k.keyId, { killSwitch: !a.killSwitch }), a.killSwitch ? 'Kill switch released.' : 'Kill switch on: the key cannot place orders.'); } }, a.killSwitch ? 'RELEASE' : 'KILL SWITCH'),
      this.confirm === k.keyId
        ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', 'data-revoke-confirm': k.keyId, onclick: () => { this.confirm = null; void this.run(() => this.d.client.revoke(k.keyId), 'Key revoked; its open orders get a cancel request.'); } }, 'CONFIRM REVOKE')
        : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-revoke': k.keyId, onclick: () => { this.confirm = k.keyId; this.render(); } }, 'REVOKE'),
    ];
    return h('tr', { 'data-key': k.keyId },
      td(h('span', {}, k.label, h('br'), h('span', { class: 'tr-hint' }, k.keyId))), td(k.scopes.join(', ')), td(state),
      td(`max ${a.maxOpenOrders} open, order <= ${fmtAmount('USDC', a.maxOrderNotional)}, day <= ${fmtAmount('USDC', a.dailyBudget)}${a.priceBandBp === null ? '' : `, band ${a.priceBandBp / 100} %`}${a.allowedPairs.length ? `, pairs: ${a.allowedPairs.join(' ')}` : ''}`, 'tr-wrap'),
      td(k.lastUsedAtMs ? new Date(k.lastUsedAtMs).toLocaleString() : 'never'), td(h('div', { class: 'tr-row' }, ...(act ?? []))));
  }

  private secretBox(k: CreateTradeKeyResponse): HTMLElement {
    const copy = h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'key-copy' }, 'COPY');
    copy.addEventListener('click', () => { void copyText(k.secret).then((ok) => { copy.textContent = ok ? 'COPIED' : 'COPY FAILED'; }); });
    return h('div', { class: 'tr-secret', role: 'alert' },
      h('strong', {}, `Key "${k.label}" created. Copy the secret now: it is shown only once.`),
      h('code', { class: 'tr-code', id: 'key-secret' }, k.secret), copy,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { this.secret = null; this.render(); } }, 'I SAVED IT'));
  }

  private createForm(s: TradeState): HTMLElement {
    const f = (label: string, id: string, value: string, hint: string): HTMLElement =>
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), h('input', { class: 'input', id, value, autocomplete: 'off', inputmode: 'decimal' }), h('span', { class: 'field-hint' }, hint));
    const scopes = TRADE_SCOPES.map((sc) => h('label', { class: 'tr-check' }, h('input', { type: 'checkbox', name: 'scope', value: sc, checked: sc !== 'manage' ? true : null }), ` ${sc}`));
    const form = h('form', { class: 'tr-keyform', id: 'key-form' },
      h('h3', { class: 'tr-h3' }, `New key for ${s.planetId}`),
      f('LABEL', 'key-label', 'my bot', 'Shown in the list.'), h('fieldset', { class: 'tr-fieldset' }, h('legend', { class: 'field-label' }, 'SCOPES'), ...scopes),
      f('MAX OPEN ORDERS', 'key-open', '5', 'At most this many resting orders.'),
      f('MAX ORDER (mock USDC)', 'key-notional', '5', 'Largest single order, total quote.'),
      f('DAILY BUDGET (mock USDC)', 'key-daily', '50', 'Committed per UTC day, open orders count in full.'),
      f('PRICE BAND (%)', 'key-band', '', 'Max distance from the organic reference; empty = no band.'),
      h('div', { class: 'tr-row' }, h('button', { type: 'submit', class: 'btn btn-primary btn-sm', id: 'key-create' }, 'CREATE KEY')));
    form.addEventListener('submit', (e) => { e.preventDefault(); void this.create(form, s.planetId); });
    this.form = form;
    return form;
  }

  private async create(form: HTMLFormElement, planetId: string): Promise<void> {
    const val = (id: string): string => (form.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '').trim();
    const scopes = [...form.querySelectorAll<HTMLInputElement>('input[name=scope]:checked')].map((x) => x.value as TradeScope);
    const notional = tryParse('USDC', val('key-notional'));
    const daily = tryParse('USDC', val('key-daily'));
    const open = Number(val('key-open'));
    const band = val('key-band');
    if (!val('key-label')) return this.fail('Give the key a label.');
    if (scopes.length === 0) return this.fail('Pick at least one scope.');
    if (notional === null || daily === null) return this.fail('Max order and daily budget must be amounts above zero (mock USDC).');
    if (!Number.isInteger(open) || open < 0 || open > 1000) return this.fail('Max open orders must be a whole number from 0 to 1000.');
    const bandBp = band === '' ? null : Math.round(Number(band) * 100);
    if (bandBp !== null && (!Number.isFinite(bandBp) || bandBp < 0 || bandBp > 100_000)) return this.fail('Price band must be a percentage from 0 to 1000.');
    const req: CreateTradeKeyRequest = { planetId, label: val('key-label'), scopes, allowance: { maxOpenOrders: open, maxOrderNotional: notional.toString(), dailyBudget: daily.toString(), priceBandBp: bandBp } };
    try {
      this.secret = await this.d.client.createKey(req);
      this.message = null;
      this.d.reload();
      this.render();
    } catch (err) { this.fail(err instanceof TradeApiFailure ? `${err.code}: ${err.message}` : 'Could not create the key.'); }
  }

  private fail(text: string): void { this.message = note(text, 'err'); this.render(); }

  private async run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try { await fn(); this.message = note(ok); } catch (err) { this.message = note(err instanceof TradeApiFailure ? `${err.code}: ${err.message}` : 'Failed.', 'err'); }
    this.d.reload();
    this.render();
  }
}

