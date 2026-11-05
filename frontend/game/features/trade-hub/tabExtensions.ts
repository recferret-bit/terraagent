import type { FeatureContext, TradeHubTabDef, TradeHubTabInstance } from '../../core/registry/types';
import { makeBtn, makeDiv } from '../shared/dom';

interface Entry { def: TradeHubTabDef; btn: HTMLButtonElement; body: HTMLElement; inst: TradeHubTabInstance | null }

/**
 * Extra tabs of the Trade Hub panel (W13-20: MARKET). A feature registers `{ id, label, mount }`; the tab button joins the tab
 * row, its body is mounted on the first time the tab is shown and sits where the export/import form is while it is active.
 */
export class TabExtensions {
  private readonly entries = new Map<string, Entry>();
  private active: string | null = null;

  constructor(
    private readonly tabsRow: HTMLElement,
    private readonly formBody: HTMLElement,
    private readonly ctx: FeatureContext | undefined,
    private readonly onChange: (activeId: string | null) => void,
  ) {}

  register(def: TradeHubTabDef): () => void {
    if (this.entries.has(def.id)) return () => undefined;
    const btn = makeBtn('ta-trade-hub__tab btn-sm plate-sm', `trade-hub-tab-${def.id}`, def.label, () => this.show(def.id));
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-active', 'false');
    btn.setAttribute('aria-selected', 'false');
    const body = makeDiv('ta-trade-hub__tab-body plate-sm', `trade-hub-ext-${def.id}`);
    body.hidden = true;
    this.tabsRow.append(btn);
    this.formBody.after(body);
    this.entries.set(def.id, { def, btn, body, inst: null });
    return () => this.remove(def.id);
  }

  /** Shows the extension tab `id`, or the export/import form for `null`. */
  show(id: string | null): void {
    if (id !== null && !this.entries.has(id)) return;
    for (const [k, e] of this.entries) {
      const on = k === id;
      if (!on && this.active === k) e.inst?.onHide?.();
      e.body.hidden = !on;
      e.btn.setAttribute('data-active', String(on));
      e.btn.setAttribute('aria-selected', String(on));
      if (on) {
        if (!e.inst && this.ctx) e.inst = e.def.mount(e.body, this.ctx);
        e.inst?.onShow?.();
      }
    }
    if (id !== null) {
      for (const b of this.tabsRow.querySelectorAll('button')) if (![...this.entries.values()].some((e) => e.btn === b)) { b.setAttribute('data-active', 'false'); b.setAttribute('aria-selected', 'false'); }
    }
    this.formBody.hidden = id !== null;
    this.active = id;
    this.onChange(id);
  }

  private remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (this.active === id) this.show(null);
    e.inst?.dispose();
    e.btn.remove();
    e.body.remove();
    this.entries.delete(id);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }
}
