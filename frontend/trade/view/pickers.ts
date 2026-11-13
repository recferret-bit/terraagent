import { mockLabel, pairId, parsePairId, type MarketTokenKey, type ResourceKey } from '@terra/contracts';
import { connLabel } from '../model/sse';
import type { ConnState, PairView } from '../model/state';
import { pickQuote } from '../model/units';
import { h } from './dom';

export interface PickerHandlers { pair(pair: string): void; planet(id: string): void; signOut(): void }

/** Header controls: planet, base resource and quote token (only combinations the server lists as tradable), connection chip. */
export class Pickers {
  readonly root: HTMLElement;
  private readonly planet = h('input', { class: 'input', id: 'pk-planet', list: 'pk-planets', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Planet id' });
  private readonly planets = h('datalist', { id: 'pk-planets' });
  private readonly base = h('select', { class: 'input', id: 'pk-base', 'aria-label': 'Resource' });
  private readonly quote = h('select', { class: 'input', id: 'pk-quote', 'aria-label': 'Quote token' });
  private readonly conn = h('span', { class: 'chip-live tr-conn', id: 'tr-conn', 'data-testid': 'trade-conn', role: 'status', 'data-conn': 'connecting' });
  private pairs: readonly PairView[] = [];

  constructor(private readonly who: string, private readonly hd: PickerHandlers) {
    const go = h('form', { class: 'tr-planetform' }, this.planet, h('button', { type: 'submit', class: 'btn btn-ghost btn-sm' }, 'GO'));
    go.addEventListener('submit', (e) => { e.preventDefault(); const v = this.planet.value.trim(); if (v) hd.planet(v); });
    this.base.addEventListener('change', () => { this.fillQuotes(); this.emit(); });
    this.quote.addEventListener('change', () => this.emit());
    const field = (label: string, el: HTMLElement, id: string): HTMLElement => h('div', { class: 'field tr-pick' }, h('label', { class: 'field-label', for: id }, label), el);
    this.root = h('div', { class: 'tr-pickers' },
      field('PLANET', go, 'pk-planet'), this.planets, field('RESOURCE', this.base, 'pk-base'), field('QUOTE', this.quote, 'pk-quote'),
      h('div', { class: 'tr-who' }, this.conn, h('span', { class: 'tr-hint', id: 'tr-who' }, `as ${who}`), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-testid': 'pilot-sign-out', onclick: () => hd.signOut() }, 'SIGN OUT')));
  }

  setPlanets(ids: readonly string[]): void { this.planets.replaceChildren(...ids.map((id) => h('option', { value: id }))); }

  /** Rebuilds the selects from the tradable pairs and selects the active one. */
  sync(pairs: readonly PairView[], planetId: string, active: string): void {
    this.pairs = pairs;
    if (document.activeElement !== this.planet) this.planet.value = planetId;
    const bases = [...new Set(pairs.map((p) => p.base))];
    const cur = parsePairId(active);
    this.base.replaceChildren(...bases.map((b) => h('option', { value: b }, b)));
    if (cur && bases.includes(cur.base)) this.base.value = cur.base;
    this.fillQuotes(cur?.quote);
  }

  private fillQuotes(want?: MarketTokenKey): void {
    const qs = this.pairs.filter((p) => p.base === this.base.value).map((p) => p.quote);
    const keep = (this.quote.value || undefined) as MarketTokenKey | undefined;
    this.quote.replaceChildren(...qs.map((q) => h('option', { value: q }, mockLabel(q))));
    const pick = pickQuote(qs, want, keep);
    if (pick) this.quote.value = pick;
  }

  private emit(): void {
    if (this.base.value && this.quote.value) this.hd.pair(pairId(this.base.value as ResourceKey, this.quote.value as MarketTokenKey));
  }

  setConn(c: ConnState, attempt: number): void {
    this.conn.textContent = connLabel(c, attempt);
    this.conn.dataset.conn = c;
  }
}
