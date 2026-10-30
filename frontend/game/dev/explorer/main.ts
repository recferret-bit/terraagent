import './style.css';
import { fetchRows, ping, type Row, type TabId } from './api';
import { TABS } from './columns';
import { renderTable } from './table';

const REFRESH_MS = 1000;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Mock chain explorer (`/dev/chain/`): polls the read-only dev routes and renders the active tab. */
class Explorer {
  private tab: TabId = 'receipts';
  private paused = false;
  private account = '';
  private readonly seen = new Map<TabId, Set<string>>();
  private readonly panel = el('section', 'xpanel plate-sm');
  private readonly err = el('span', 'xerr');
  private readonly stamp = el('span', 'xfoot');
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private inflight: AbortController | null = null;
  private pingBtn!: HTMLButtonElement;
  private pauseBtn!: HTMLButtonElement;

  constructor(private readonly root: HTMLElement) {
    root.append(this.header(), this.bar(), this.tabs(), this.panel, this.stamp);
    void this.refresh();
    setInterval(() => { if (!this.paused && !document.hidden) void this.refresh(); }, REFRESH_MS);
  }

  private header(): HTMLElement {
    const h = el('header', 'xhead plate');
    const left = el('div');
    left.append(el('p', 'eyebrow', 'DEV TOOLS · NEAR §1A'), el('h1', 'h2', 'MOCK CHAIN EXPLORER'));
    h.append(left, el('span', 'badge badge-ai', 'NETWORK · mock'));
    return h;
  }

  private bar(): HTMLElement {
    const bar = el('div', 'xbar');
    const input = el('input', 'input');
    input.placeholder = 'Filter by account (e.g. alice.test)';
    input.setAttribute('aria-label', 'Filter by account');
    input.addEventListener('input', () => { this.account = input.value.trim(); this.seen.clear(); void this.refresh(); });
    this.pauseBtn = el('button', 'btn btn-ghost btn-sm', 'PAUSE');
    this.pauseBtn.addEventListener('click', () => {
      this.paused = !this.paused;
      this.pauseBtn.textContent = this.paused ? 'RESUME' : 'PAUSE';
      if (!this.paused) void this.refresh();
    });
    this.pingBtn = el('button', 'btn btn-primary btn-sm', 'CHAIN.PING');
    this.pingBtn.addEventListener('click', () => void this.doPing());
    bar.append(input, this.pauseBtn, this.pingBtn, el('span', 'chip-live', 'AUTO-REFRESH 1 S'), this.err);
    return bar;
  }

  private tabs(): HTMLElement {
    const nav = el('nav', 'tabs');
    nav.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const b = el('button', 'btn btn-ghost btn-sm', t.label.toUpperCase());
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => { this.tab = t.id; this.syncTabs(); this.panel.replaceChildren(); void this.refresh(); });
      this.tabButtons.set(t.id, b);
      nav.append(b);
    }
    this.syncTabs();
    return nav;
  }

  private syncTabs(): void {
    for (const [id, b] of this.tabButtons) b.setAttribute('aria-selected', String(id === this.tab));
  }

  private async doPing(): Promise<void> {
    this.pingBtn.disabled = true;
    try { await ping(); await this.refresh(); } catch (e) { this.err.textContent = String(e instanceof Error ? e.message : e); } finally { this.pingBtn.disabled = false; }
  }

  private async refresh(): Promise<void> {
    this.inflight?.abort();
    const ctl = (this.inflight = new AbortController());
    const tab = this.tab;
    let rows: Row[];
    try {
      rows = await fetchRows(tab, { account: this.account }, ctl.signal);
    } catch (e) {
      if (!ctl.signal.aborted) this.err.textContent = String(e instanceof Error ? e.message : e);
      return;
    }
    if (ctl.signal.aborted || tab !== this.tab) return;
    this.err.textContent = '';
    this.show(tab, rows);
  }

  private show(tab: TabId, rows: Row[]): void {
    const def = TABS.find((t) => t.id === tab)!;
    const seen = this.seen.get(tab) ?? null;
    this.panel.replaceChildren(renderTable(def, rows, seen));
    // Rows already shown are not highlighted again, so only truly new rows flash. `seen` stays null until the first load of a tab.
    const next = seen ?? new Set<string>();
    for (const r of rows) next.add(def.key(r));
    this.seen.set(tab, next);
    this.stamp.textContent = `${rows.length} row(s) · updated ${new Date().toLocaleTimeString()}`;
  }
}

new Explorer(document.getElementById('app')!);
