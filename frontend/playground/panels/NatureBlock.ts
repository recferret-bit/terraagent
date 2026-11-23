import { PLANET_LABEL, type PgState } from '../state';
import {
  FLORA_ENTRIES,
  isFloraId,
  listFloraEntries,
  type FloraGroup,
} from '../content/floraCatalog';

export interface NatureBlockHandlers {
  onPickFlora(id: string): void;
  onFloraRow(group: FloraGroup): void;
}

const BIOME_TAG: Record<string, string> = {
  ...PLANET_LABEL,
  all: 'Biome',
};

/**
 * Dedicated "Trees & Ground Objects" block + searchable Faction Plate dropdown
 * mounted inside the Playground left sidebar (`[data-side-pane="units"]`).
 */
export class NatureBlock {
  private root!: HTMLElement;
  private selectEl!: HTMLSelectElement;
  private filterGroup: FloraGroup | 'all' = 'all';

  constructor(private state: PgState, private handlers: NatureBlockHandlers) {}

  mount(parent: HTMLElement, beforeEl?: HTMLElement | null): void {
    const block = document.createElement('section');
    block.className = 'nb-block';
    block.dataset.testid = 'pg-nature-block';
    block.innerHTML = this.shellHtml();
    if (beforeEl) parent.insertBefore(block, beforeEl);
    else parent.appendChild(block);

    this.root = block;
    this.selectEl = block.querySelector<HTMLSelectElement>('#pg-flora-select')!;
    this.selectEl.addEventListener('change', () => {
      const val = this.selectEl.value;
      if (val && isFloraId(val)) this.handlers.onPickFlora(val);
    });
    block.querySelectorAll<HTMLButtonElement>('[data-nb-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = (btn.dataset.nbFilter ?? 'all') as FloraGroup | 'all';
        this.filterGroup = next;
        this.render();
      });
    });
    block.querySelectorAll<HTMLButtonElement>('[data-nb-row]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const grp = btn.dataset.nbRow as FloraGroup;
        this.handlers.onFloraRow(grp);
      });
    });
    this.render();
  }

  render(): void {
    if (!this.root) return;
    const treeCount = listFloraEntries('tree').length;
    const groundCount = listFloraEntries('ground').length;
    this.root.classList.toggle('is-active', isFloraId(this.state.id) || this.state.floraRow !== null);

    this.root.querySelectorAll<HTMLButtonElement>('[data-nb-filter]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.nbFilter === this.filterGroup);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-nb-row]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.nbRow === this.state.floraRow);
    });

    this.populateSelect(treeCount, groundCount);
  }

  private populateSelect(treeCount: number, groundCount: number): void {
    const trees = listFloraEntries('tree');
    const ground = listFloraEntries('ground');
    const q = this.state.filter;
    const matches = (id: string, label: string, sub: string) =>
      !q || `${id} ${label} ${sub}`.toLowerCase().includes(q);

    const optHtml = (e: (typeof FLORA_ENTRIES)[number]) =>
      `<option value="${e.id}">${e.label} · ${BIOME_TAG[e.biomeHint] ?? e.biomeHint}</option>`;

    const chunks: string[] = ['<option value="">— Pick a tree or ground object —</option>'];
    if (this.filterGroup === 'all' || this.filterGroup === 'tree') {
      const visTrees = trees.filter((e) => matches(e.id, e.label, e.subtitle));
      if (visTrees.length) {
        chunks.push(`<optgroup label="Trees (${visTrees.length}/${treeCount} breeds)">${visTrees.map(optHtml).join('')}</optgroup>`);
      }
    }
    if (this.filterGroup === 'all' || this.filterGroup === 'ground') {
      const visGround = ground.filter((e) => matches(e.id, e.label, e.subtitle));
      if (visGround.length) {
        chunks.push(`<optgroup label="Ground Objects (${visGround.length}/${groundCount})">${visGround.map(optHtml).join('')}</optgroup>`);
      }
    }
    this.selectEl.innerHTML = chunks.join('');
    this.selectEl.value = isFloraId(this.state.id) ? this.state.id : '';
  }

  private shellHtml(): string {
    const total = FLORA_ENTRIES.length;
    const trees = listFloraEntries('tree').length;
    const ground = listFloraEntries('ground').length;
    return `<div class="nb-head">
      <span class="nb-title">Trees &amp; Ground <b>(${total})</b></span>
      <span class="nb-rows">
        <button type="button" class="row-btn" data-nb-row="tree" title="Spawn all ${trees} tree breeds side-by-side">trees</button>
        <button type="button" class="row-btn" data-nb-row="ground" title="Spawn all ${ground} ground objects side-by-side">ground</button>
      </span>
    </div>
    <div class="nb-tabs" role="group" aria-label="Flora group filter">
      <button type="button" class="nb-tab on" data-nb-filter="all">ALL (${total})</button>
      <button type="button" class="nb-tab" data-nb-filter="tree">TREES (${trees})</button>
      <button type="button" class="nb-tab" data-nb-filter="ground">GROUND (${ground})</button>
    </div>
    <select id="pg-flora-select" class="nb-select" aria-label="Trees and ground objects"></select>`;
  }
}
