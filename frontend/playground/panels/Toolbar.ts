import { PLANET_KINDS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { DEPOSIT_STAGES, type DepositVisualStage } from '@terra/render/kitbash';
import { $, setBtn } from '../dom';
import { PLANET_LABEL, TOGGLES, VIEWS, type PgState, type ToggleKey, type View } from '../state';
import { bindDock } from './dock';

export interface ToolbarHandlers {
  onView(v: View): void;
  onPlanet(k: PlanetKind): void;
  onToggle(k: ToggleKey): void;
  onShot(): void;
  onSheet(): void;
  onBuild(): void;
  onWorkTarget(): void;
  onDepositStage(stage: DepositVisualStage): void;
}

const TOGGLE_LABEL: Partial<Record<ToggleKey, string>> = { pixel: 'pixel art', wire: 'wireframe', surface: 'planet surface', hexTerrain: 'hex terrain', work: 'work pose', row: 'spawn row', validate: 'validate parts', lights: 'Lights [L]', human: '1.8m human' };

type BarTab = 'view' | 'world' | 'look' | 'work';

const ORDER = {
  view: ['turntable'],
  world: ['surface', 'hexTerrain'],
  look: ['wire', 'human'],
  work: ['work', 'row', 'validate', 'lights'],
} as const satisfies Record<'view' | 'world' | 'look' | 'work', readonly ToggleKey[]>;

type OrderedToggle = (typeof ORDER)[keyof typeof ORDER][number];
type Assert<T extends true> = T;
type _AllTogglesTabbed = Assert<Exclude<ToggleKey, OrderedToggle | 'bloom' | 'pixel' | 'shadows'> extends never ? true : never>;

function tog(k: ToggleKey): string {
  return `<button class="pg-btn tog" data-k="${k}">${TOGGLE_LABEL[k] ?? k}</button>`;
}

function togs(keys: readonly ToggleKey[]): string {
  const live = new Set<ToggleKey>(TOGGLES);
  return keys.filter((k) => live.has(k)).map((k) => tog(k)).join('');
}

function viewsHtml(): string {
  const buttons = VIEWS.map((v, i) => `<button class="pg-btn" data-v="${v}" title="${i + 1}">${v}</button>`).join('');
  return `<div id="views" style="display:flex;gap:4px">${buttons}</div>`;
}

function planetsHtml(): string {
  const buttons = PLANET_KINDS.map((k) => `<button class="pg-btn" data-v="${k}">${PLANET_LABEL[k]}</button>`).join('');
  return `<div id="planet-btns" class="planet">${buttons}</div>`;
}

function depositHtml(): string {
  const buttons = DEPOSIT_STAGES.map(
    (st) => `<button class="pg-btn" data-v="${st}" data-deposit-stage="${st}">${st.toUpperCase()}</button>`,
  ).join('');
  return `<div id="deposit-stage-btns" data-testid="pg-deposit-stage" class="planet" title="Resource deposit visual stage"><span class="pg-stage-lbl">STAGE:</span>${buttons}</div>`;
}

function workHtml(): string {
  return '<button class="pg-btn" id="work-target" title="cycle interaction target for 3D work particles">target: tree</button><button class="pg-btn" id="build" title="construction scaffold stage">build</button>';
}

function page(tab: BarTab, body: string): string {
  const hidden = tab === 'view' ? '' : ' hidden';
  return `<div class="bar-page" data-page="${tab}"${hidden}>${body}</div>`;
}

function barHead(): string {
  return `<div class="bar-head">
      <div class="bar-tabs" role="tablist">
        <button type="button" class="pg-btn bar-tab on" data-tab="view" role="tab">View</button>
        <button type="button" class="pg-btn bar-tab" data-tab="world" role="tab">World</button>
        <button type="button" class="pg-btn bar-tab" data-tab="look" role="tab">Look</button>
        <button type="button" class="pg-btn bar-tab" data-tab="work" role="tab">Work</button>
      </div>
    </div>`;
}

function overlayHtml(): string {
  const view = `${viewsHtml()}<span class="sep"></span>${togs(ORDER.view)}`;
  const world = `${planetsHtml()}<span class="sep"></span>${togs(ORDER.world)}`;
  const work = `${depositHtml()}<span class="sep"></span>${togs(ORDER.work)}<span class="sep"></span>${workHtml()}`;
  return `
  <div class="panel" id="info"></div>
  <div class="panel" id="bar">
    ${barHead()}
    ${page('view', view)}
    ${page('world', world)}
    ${page('look', togs(ORDER.look))}
    ${page('work', work)}
  </div><div id="toast"></div>`;
}

/** Tabbed bottom controls and the info/toast overlay shell. */
export class Toolbar {
  private tab: BarTab = 'view';

  constructor(private state: PgState, private on: ToolbarHandlers) {}

  build() {
    const ov = $('#overlay');
    const showBar = document.getElementById('pg-show-bar');
    showBar?.remove();
    ov.innerHTML = overlayHtml();
    if (showBar) ov.appendChild(showBar);
    ov.querySelectorAll<HTMLElement>('#views [data-v]').forEach((b) => (b.onclick = () => this.on.onView(b.dataset.v as View)));
    ov.querySelectorAll<HTMLElement>('#planet-btns [data-v]').forEach((b) => (b.onclick = () => this.on.onPlanet(b.dataset.v as PlanetKind)));
    ov.querySelectorAll<HTMLElement>('#deposit-stage-btns [data-deposit-stage]').forEach(
      (b) => (b.onclick = () => this.on.onDepositStage(b.dataset.depositStage as DepositVisualStage)),
    );
    ov.querySelectorAll<HTMLElement>('.tog').forEach((b) => (b.onclick = () => this.on.onToggle(b.dataset.k as ToggleKey)));
    ov.querySelectorAll<HTMLElement>('#bar [data-tab]').forEach((b) => (b.onclick = () => this.showTab(b.dataset.tab as BarTab)));
    $('#build').onclick = () => this.on.onBuild();
    $('#work-target').onclick = () => this.on.onWorkTarget();
    this.syncToggles();
    this.showTab(this.tab);
    bindDock({
      id: 'bar',
      panel: $('#bar'),
      edge: 'bottom',
      showLabel: 'CONTROLS',
      showTitle: 'Hide or show controls',
    });
  }

  private showTab(tab: BarTab = this.tab): void {
    this.tab = tab;
    const bar = $('#bar');
    bar.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    bar.querySelectorAll<HTMLElement>('[data-page]').forEach((p) => {
      p.hidden = p.dataset.page !== tab;
    });
  }

  syncToggles() {
    document.querySelectorAll<HTMLElement>('.tog').forEach((b) => {
      const k = b.dataset.k as ToggleKey;
      b.classList.toggle('on', k === 'row' ? !!this.state.row : !!this.state[k]);
    });
    const build = document.querySelector<HTMLElement>('#build');
    if (build) { build.textContent = `build ${Math.round(this.state.build * 100)}%`; build.classList.toggle('on', this.state.build !== 1); }
    const wt = document.querySelector<HTMLElement>('#work-target');
    if (wt) { wt.textContent = `target: ${this.state.workTarget}`; wt.classList.toggle('on', this.state.work); }
    setBtn('#deposit-stage-btns', this.state.depositStage);
  }
  setView(v: View) { setBtn('#views', v); }
  setPlanet(k: PlanetKind) { setBtn('#planet-btns', k); }
  clearBar() { setBtn('#views', null); }
}
