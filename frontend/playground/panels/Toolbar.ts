import { PLANET_KINDS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { $, setBtn } from '../dom';
import { PLANET_LABEL, TOGGLES, VIEWS, type PgState, type ToggleKey, type View } from '../state';

export interface ToolbarHandlers {
  onView(v: View): void; onPlanet(k: PlanetKind): void; onToggle(k: ToggleKey): void; onShot(): void; onSheet(): void;
}

const TOGGLE_LABEL: Partial<Record<ToggleKey, string>> = { wire: 'wireframe', surface: 'planet surface', row: 'spawn row', validate: 'validate parts', hex: 'hex grid', human: '1.8m human' };

/** Bottom toolbar (views, planets, toggles, capture) and the info/tip/toast overlay shell. */
export class Toolbar {
  constructor(private state: PgState, private on: ToolbarHandlers) {}

  build() {
    const ov = $('#overlay');
    ov.innerHTML = `
  <div id="tip">LMB rotate · wheel zoom · RMB pan · dbl-click refocus</div>
  <div class="panel" id="info"></div>
  <div class="panel" id="bar">
    <div id="views" style="display:flex;gap:4px">${VIEWS.map((v, i) => `<button class="pg-btn" data-v="${v}" title="${i + 1}">${v}</button>`).join('')}</div>
    <span class="sep"></span>
    <div id="planet-btns" class="planet">${PLANET_KINDS.map((k) => `<button class="pg-btn" data-v="${k}">${PLANET_LABEL[k]}</button>`).join('')}</div>
    <span class="sep"></span>
    ${TOGGLES.map((k) => `<button class="pg-btn tog" data-k="${k}">${TOGGLE_LABEL[k] ?? k}</button>`).join('')}
    <span class="sep"></span>
    <button class="pg-btn" id="shot">PNG</button><button class="pg-btn" id="sheet">4-view sheet</button>
  </div><div id="toast"></div>`;
    ov.querySelectorAll<HTMLElement>('#views [data-v]').forEach((b) => (b.onclick = () => this.on.onView(b.dataset.v as View)));
    ov.querySelectorAll<HTMLElement>('#planet-btns [data-v]').forEach((b) => (b.onclick = () => this.on.onPlanet(b.dataset.v as PlanetKind)));
    ov.querySelectorAll<HTMLElement>('.tog').forEach((b) => (b.onclick = () => this.on.onToggle(b.dataset.k as ToggleKey)));
    $('#shot').onclick = () => this.on.onShot();
    $('#sheet').onclick = () => this.on.onSheet();
    this.syncToggles();
  }

  syncToggles() {
    document.querySelectorAll<HTMLElement>('.tog').forEach((b) => {
      const k = b.dataset.k as ToggleKey;
      b.classList.toggle('on', k === 'row' ? !!this.state.row : !!this.state[k]);
    });
  }
  setView(v: View) { setBtn('#views', v); }
  setPlanet(k: PlanetKind) { setBtn('#planet-btns', k); }
  clearBar() { setBtn('#bar', null); }
}
