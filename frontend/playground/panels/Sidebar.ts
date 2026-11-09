import { ArchetypeCatalog, type ArchetypeCategory } from '@terra/render/kitbash';
import { $ } from '../dom';
import { CATS, type PgState } from '../state';
import { bindDock } from './dock';

export interface SidebarHandlers { onSelect(id: string): void; onRow(cat: ArchetypeCategory): void; }

type SideTab = 'hive' | 'march' | 'units';

const SIDE_TABS: readonly SideTab[] = ['hive', 'march', 'units'];
const TAB_LABEL: Record<SideTab, string> = { hive: 'HIVE', march: 'MARCH', units: 'UNITS' };

/** Left sidebar: hive-life, group march, and the archetype list on separate tabs. */
export class Sidebar {
  private expanded = new Set<ArchetypeCategory>();

  constructor(private state: PgState, private on: SidebarHandlers) {}

  build() {
    $('#side').innerHTML = sideShell(ArchetypeCatalog.list().length);
    this.bindTabs();
    bindDock({
      id: 'side',
      panel: $('#side'),
      edge: 'left',
      showLabel: 'LIST',
      showTitle: 'Hide or show the object list',
      mount: $('#stage'),
    });
    ($('#search') as HTMLInputElement).addEventListener('input', (e) => {
      this.state.filter = (e.target as HTMLInputElement).value.toLowerCase();
      this.render();
    });
    this.showTab(this.openingTab());
    this.render();
  }

  /** Shows one pane. Does not change the scene, the sim, or PgState. */
  showTab(tab: 'hive' | 'march' | 'units'): void {
    const root = $('#side');
    root.querySelectorAll<HTMLButtonElement>('[data-side-tab]').forEach((btn) => {
      const on = btn.dataset.sideTab === tab;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    root.querySelectorAll<HTMLElement>('[data-side-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.sidePane !== tab;
    });
  }

  visibleIds(): string[] {
    const f = this.state.filter;
    return ArchetypeCatalog.list().filter((e) => !f || (e.id + ' ' + e.label + ' ' + e.category).toLowerCase().includes(f)).map((e) => e.id);
  }

  render() {
    const list = $('#list');
    list.innerHTML = '';
    const vis = new Set(this.visibleIds());
    const searching = this.state.filter.length > 0;
    for (const cat of CATS) {
      const items = ArchetypeCatalog.list(cat).filter((e) => vis.has(e.id));
      if (!items.length) continue;
      list.appendChild(this.categoryGroup(cat, items, searching || this.expanded.has(cat)));
    }
    this.mark();
  }

  mark() {
    const { id, row } = this.state;
    document.querySelectorAll<HTMLElement>('.item').forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
    document.querySelectorAll<HTMLElement>('.row-btn').forEach((b) => {
      b.classList.toggle('on', b.closest<HTMLElement>('.grp')?.dataset.cat === row);
    });
    const sel = document.querySelector<HTMLElement>('.item.sel');
    const body = sel?.closest<HTMLElement>('.cat-body');
    if (sel && body && !body.hidden) sel.scrollIntoView({ block: 'nearest' });
  }

  private categoryGroup(cat: ArchetypeCategory, items: { id: string; label: string }[], open: boolean): HTMLElement {
    const grp = document.createElement('div');
    grp.className = 'grp';
    grp.dataset.cat = cat;
    const gh = document.createElement('div');
    gh.className = 'gh';
    gh.append(this.categoryToggle(cat, items.length, open), this.rowButton(cat));
    const body = document.createElement('div');
    body.className = 'cat-body';
    if (!open) body.hidden = true;
    for (const e of items) {
      const b = document.createElement('button');
      b.className = 'item';
      b.dataset.id = e.id;
      b.innerHTML = `${e.label}<small>${e.id}</small>`;
      b.onclick = () => this.on.onSelect(e.id);
      body.appendChild(b);
    }
    grp.append(gh, body);
    return grp;
  }

  private categoryToggle(cat: ArchetypeCategory, count: number, open: boolean): HTMLButtonElement {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cat-toggle';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.innerHTML = `<span class="cat-chevron">${open ? '▾' : '▸'}</span><span class="cat-name">${cat}</span><span class="cat-count">(${count})</span>`;
    toggle.onclick = () => this.toggleCategory(cat);
    return toggle;
  }

  private rowButton(cat: ArchetypeCategory): HTMLButtonElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row-btn';
    row.title = 'Spawn row (R)';
    row.textContent = 'row';
    if (this.state.row === cat) row.classList.add('on');
    row.onclick = (ev) => { ev.stopPropagation(); this.on.onRow(cat); };
    return row;
  }

  private toggleCategory(cat: ArchetypeCategory): void {
    if (this.state.filter.length > 0) return;
    if (this.expanded.has(cat)) this.expanded.delete(cat);
    else this.expanded.add(cat);
    this.render();
  }

  private bindTabs(): void {
    $('#side').querySelectorAll<HTMLButtonElement>('[data-side-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.sideTab;
        if (tab === 'hive' || tab === 'march' || tab === 'units') this.showTab(tab);
      });
    });
  }

  /** March wins over a hive fixture; otherwise the archetype list is the default. */
  private openingTab(): SideTab {
    if (this.state.march !== null) return 'march';
    if (this.state.faunaScene !== null) return 'hive';
    return 'units';
  }
}

function sideShell(count: number): string {
  const tabs = SIDE_TABS.map((id) =>
    `<button type="button" class="pg-btn" data-side-tab="${id}" role="tab" aria-selected="false">${TAB_LABEL[id]}</button>`,
  ).join('');
  return `<div class="brand"><div><a class="wm" href="/" title="Return to hub">TERRA<b>AGENT</b></a><small>3D PLAYGROUND · ${count} ARCHETYPES</small></div></div>
  <div class="side-tabs" role="tablist">${tabs}</div>
  <div class="side-pane" data-side-pane="hive" hidden></div>
  <div class="side-pane" data-side-pane="march" hidden></div>
  <div class="side-pane side-units" data-side-pane="units">
  <input id="search" placeholder="Search archetypes…  ( / )" autocomplete="off" />
  <div id="list"></div>
  <div class="side-foot"><kbd>[</kbd><kbd>]</kbd> cycle · <kbd>1</kbd>-<kbd>4</kbd> views · <kbd>T</kbd> turntable · <kbd>F</kbd> focus<br><kbd>WASD</kbd> move · <kbd>Q</kbd>/<kbd>E</kbd> rotate · <kbd>B</kbd> bloom · <kbd>R</kbd> row · <kbd>V</kbd> validate · <kbd>L</kbd> lights</div>
  </div>`;
}
