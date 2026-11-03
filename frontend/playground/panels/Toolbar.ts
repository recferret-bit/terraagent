import { PLANET_KINDS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { DEPOSIT_STAGES, type DepositVisualStage } from '@terra/render/kitbash';
import { $, setBtn } from '../dom';
import { PLANET_LABEL, TOGGLES, VIEWS, type PgState, type ToggleKey, type View } from '../state';

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

const TOGGLE_LABEL: Partial<Record<ToggleKey, string>> = { pixel: 'pixel art', wire: 'wireframe', surface: 'planet surface', hexTerrain: 'hex terrain', hatch: 'border hatch', work: 'work pose', row: 'spawn row', validate: 'validate parts', lights: 'Lights [L]', hex: 'hex grid', human: '1.8m human' };

/** Bottom toolbar (views, planets, deposit stages, toggles, capture) and the info/tip/toast overlay shell. */
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
    <div id="deposit-stage-btns" data-testid="pg-deposit-stage" class="planet" title="Resource deposit visual stage">
      <span class="pg-stage-lbl">STAGE:</span>
      ${DEPOSIT_STAGES.map((st) => `<button class="pg-btn" data-v="${st}" data-deposit-stage="${st}">${st.toUpperCase()}</button>`).join('')}
    </div>
    <span class="sep"></span>
    ${TOGGLES.map((k) => `<button class="pg-btn tog" data-k="${k}">${TOGGLE_LABEL[k] ?? k}</button>`).join('')}
    <button class="pg-btn" id="work-target" title="cycle interaction target for 3D work particles">target: tree</button>
    <button class="pg-btn" id="build" title="construction scaffold stage">build</button>
    <span class="sep"></span>
    <button class="pg-btn" id="shot">PNG</button><button class="pg-btn" id="sheet">4-view sheet</button>
  </div><div id="toast"></div>`;
    ov.querySelectorAll<HTMLElement>('#views [data-v]').forEach((b) => (b.onclick = () => this.on.onView(b.dataset.v as View)));
    ov.querySelectorAll<HTMLElement>('#planet-btns [data-v]').forEach((b) => (b.onclick = () => this.on.onPlanet(b.dataset.v as PlanetKind)));
    ov.querySelectorAll<HTMLElement>('#deposit-stage-btns [data-deposit-stage]').forEach(
      (b) => (b.onclick = () => this.on.onDepositStage(b.dataset.depositStage as DepositVisualStage)),
    );
    ov.querySelectorAll<HTMLElement>('.tog').forEach((b) => (b.onclick = () => this.on.onToggle(b.dataset.k as ToggleKey)));
    $('#shot').onclick = () => this.on.onShot();
    $('#sheet').onclick = () => this.on.onSheet();
    $('#build').onclick = () => this.on.onBuild();
    $('#work-target').onclick = () => this.on.onWorkTarget();
    this.syncToggles();
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
  clearBar() { setBtn('#bar', null); }
}
