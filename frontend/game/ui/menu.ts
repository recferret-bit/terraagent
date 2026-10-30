import { PLANET_KINDS, PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { worldCardHtml } from './worldCard';

export interface MenuSettings { bloom: boolean; quality: 'low' | 'high'; skipCinematic: boolean; }
export interface MenuCallbacks {
  onPlanet(kind: PlanetKind): void;
  onDeploy(kind: PlanetKind, seed: number, settings: MenuSettings): void;
  onSettings(s: MenuSettings): void;
  /** Seed edited or randomised. */
  onSeed?(seed: number): void;
}

export class MainMenu {
  readonly el = document.createElement('div');
  kind: PlanetKind;
  seed: number;
  settings: MenuSettings = { bloom: true, quality: 'high', skipCinematic: false };
  private deployBtn!: HTMLButtonElement;
  private seedInput!: HTMLInputElement;
  private errEl!: HTMLElement;

  constructor(parent: HTMLElement, private cb: MenuCallbacks, kind: PlanetKind = 'dune', seed?: number) {
    this.kind = kind;
    this.seed = seed ?? PLANET_SPECS[kind].seed;
    this.el.id = 'menu'; this.el.className = 'ui-layer';
    const cards = PLANET_KINDS.map(worldCardHtml).join('');
    this.el.innerHTML = `
      <div class="menu-top"><div><h1 class="title">TERRA<b>AGENT</b></h1><div class="subtitle">AUTONOMOUS COLONY BUILDER · SELECT A WORLD</div></div><a class="btn btn-ghost btn-sm" href="/landing.html">◂ TERRAAGENT.COM</a></div>
      <div class="menu-bottom">
        <div class="cards">${cards}</div>
        <div class="deploy-box plate">
          <div class="field-label">WORLD SEED</div>
          <div class="row"><input class="input" id="seed" inputmode="numeric" title="World seed" /><button class="btn btn-icon" id="dice" title="Randomise seed">🎲</button></div>
          <div class="settings">
            <label><input type="checkbox" id="s-bloom" checked /> bloom</label>
            <label>quality <select id="s-q"><option value="high">high</option><option value="low">low</option></select></label>
            <label><input type="checkbox" id="s-skip" /> skip cinematic</label>
          </div>
          <div id="menu-err"></div>
          <button class="btn btn-primary btn-lg" id="deploy">DEPLOY</button>
        </div>
      </div>`;
    parent.appendChild(this.el);
    this.deployBtn = this.el.querySelector('#deploy')!;
    this.seedInput = this.el.querySelector('#seed')!;
    this.errEl = this.el.querySelector('#menu-err')!;
    this.el.querySelectorAll<HTMLElement>('.world-card').forEach((c) => (c.onclick = () => this.select(c.dataset.k as PlanetKind, true)));
    this.seedInput.oninput = () => { const n = parseInt(this.seedInput.value, 10); if (Number.isFinite(n)) { this.seed = n >>> 0; cb.onSeed?.(this.seed); } };
    (this.el.querySelector('#dice') as HTMLElement).onclick = () => { this.seed = (Math.random() * 99999) | 0; this.seedInput.value = String(this.seed); cb.onSeed?.(this.seed); };
    const sb = this.el.querySelector('#s-bloom') as HTMLInputElement, sq = this.el.querySelector('#s-q') as HTMLSelectElement, ss = this.el.querySelector('#s-skip') as HTMLInputElement;
    const push = () => { this.settings = { bloom: sb.checked, quality: sq.value as 'low' | 'high', skipCinematic: ss.checked }; cb.onSettings(this.settings); };
    sb.onchange = sq.onchange = ss.onchange = push;
    this.deployBtn.onclick = () => { this.deployBtn.disabled = true; cb.onDeploy(this.kind, this.seed, this.settings); };
    this.select(kind, false);
  }

  select(k: PlanetKind, notify: boolean) {
    const changed = k !== this.kind;
    this.kind = k;
    if (changed) this.seed = PLANET_SPECS[k].seed;
    this.seedInput.value = String(this.seed);
    this.el.querySelectorAll<HTMLElement>('.world-card').forEach((c) => c.classList.toggle('sel', c.dataset.k === k));
    if (notify) this.cb.onPlanet(k);
  }
  setError(msg: string) { this.errEl.textContent = msg; this.deployBtn.disabled = false; }
  hide() { this.el.classList.add('hide'); }
  show() { this.el.classList.remove('hide'); this.deployBtn.disabled = false; this.errEl.textContent = ''; }
  dispose() { this.el.remove(); }
}
