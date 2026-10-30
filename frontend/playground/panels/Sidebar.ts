import { ArchetypeCatalog, type ArchetypeCategory } from '@shared/engine/kitbash';
import { $ } from '../dom';
import { CATS, type PgState } from '../state';

export interface SidebarHandlers { onSelect(id: string): void; onRow(cat: ArchetypeCategory): void; }

/** Left-hand archetype list with search filter and per-category "row" buttons. */
export class Sidebar {
  constructor(private state: PgState, private on: SidebarHandlers) {}

  build() {
    $('#side').innerHTML = `<div class="brand"><div><div class="wm">TERRA<b>AGENT</b></div><small>3D PLAYGROUND · ${ArchetypeCatalog.list().length} ARCHETYPES</small></div><a class="pg-home" href="/">◂ HUB</a></div>
  <input id="search" placeholder="Search archetypes…  ( / )" autocomplete="off" />
  <div id="list"></div>
  <div class="side-foot"><kbd>[</kbd><kbd>]</kbd> cycle · <kbd>1</kbd>-<kbd>4</kbd> views · <kbd>T</kbd> turntable · <kbd>F</kbd> focus<br><kbd>G</kbd> grid · <kbd>W</kbd> wire · <kbd>B</kbd> bloom · <kbd>R</kbd> row · <kbd>V</kbd> validate · dbl-click refocus</div>`;
    ($('#search') as HTMLInputElement).addEventListener('input', (e) => { this.state.filter = (e.target as HTMLInputElement).value.toLowerCase(); this.render(); });
    this.render();
  }

  visibleIds(): string[] {
    const f = this.state.filter;
    return ArchetypeCatalog.list().filter((e) => !f || (e.id + ' ' + e.label + ' ' + e.category).toLowerCase().includes(f)).map((e) => e.id);
  }

  render() {
    const list = $('#list'); list.innerHTML = '';
    const vis = new Set(this.visibleIds());
    for (const cat of CATS) {
      const items = ArchetypeCatalog.list(cat).filter((e) => vis.has(e.id));
      if (!items.length) continue;
      const grp = document.createElement('div'); grp.className = 'grp';
      const gh = document.createElement('div'); gh.className = 'gh';
      gh.innerHTML = `<span>${cat} <span style="color:var(--ta-steel)">(${items.length})</span></span><button class="row-btn ${this.state.row === cat ? 'on' : ''}" title="Spawn row (R)">row</button>`;
      (gh.querySelector('button') as HTMLButtonElement).onclick = (ev) => { ev.stopPropagation(); this.on.onRow(cat); };
      grp.appendChild(gh);
      for (const e of items) {
        const b = document.createElement('button'); b.className = 'item'; b.dataset.id = e.id;
        b.innerHTML = `${e.label}<small>${e.id}</small>`;
        b.onclick = () => this.on.onSelect(e.id);
        grp.appendChild(b);
      }
      list.appendChild(grp);
    }
    this.mark();
  }

  mark() {
    const { id, row } = this.state;
    document.querySelectorAll<HTMLElement>('.item').forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
    document.querySelectorAll<HTMLElement>('.row-btn').forEach((b) => b.classList.toggle('on', (b.parentElement!.textContent ?? '').trim().startsWith(row ?? '\u0000')));
    (document.querySelector('.item.sel') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }
}
