import { FPS_LIMITS, getFpsCap, onFpsCapChange, setFpsCap } from '@terra/render/core/perfConfig';
import '../core/ui/scrim.css';

export { DescentHud } from './descentHud';


/** Minimal gameplay HUD + pause menu. */
export class GameHud {
  readonly el = document.createElement('div');
  readonly pause = document.createElement('div');
  private res: Record<string, HTMLElement> = {};
  private readonly offFpsCap: () => void;
  constructor(parent: HTMLElement, planetName: string, seed: number, cb: { onResume(): void; onReturn(): void }) {
    this.el.id = 'hud'; this.el.className = 'ui-layer';
    this.el.innerHTML = `<div class="hud-top">
      <div class="chip plate-sm"><h4>${planetName.toUpperCase()}</h4><small>seed ${seed} · colony 01</small></div>
      <div class="chip plate-sm res">
        <div class="ta-res-chip" data-family="energy" id="chip-energy">
          <b id="r-energy">0</b>
          <span>ENERGY</span>
          <small class="ta-res-chip__rate" id="r-energy-rate">+0 / −0</small>
        </div>
        <div class="ta-res-chip" data-family="metals" id="chip-metals">
          <b id="r-metal">0</b>
          <span>METALS</span>
          <small class="ta-res-chip__rate" id="r-metals-rate">+0.0/s</small>
          <div class="ta-res-chip__breakdown plate-sm" id="r-metals-breakdown"></div>
        </div>
        <div class="ta-res-chip" data-family="minerals" id="chip-minerals">
          <b id="r-mineral">0</b>
          <span>MINERALS</span>
          <small class="ta-res-chip__rate" id="r-minerals-rate">+0.0/s</small>
          <div class="ta-res-chip__breakdown plate-sm" id="r-minerals-breakdown"></div>
        </div>
        <div class="ta-res-chip" data-family="bio" id="chip-bio">
          <b id="r-bio">0</b>
          <span>BIO</span>
          <small class="ta-res-chip__rate" id="r-bio-rate">+0.0/s</small>
          <div class="ta-res-chip__breakdown plate-sm" id="r-bio-breakdown"></div>
        </div>
        <span id="r-water" style="display:none">0</span>
      </div></div>
      <div class="hud-hint plate-sm">LMB move hero · WASD / edge pan · MMB drag · wheel zoom · Q/E rotate · Home hero · ESC menu</div>`;
    parent.appendChild(this.el);
    const fpsBtns = FPS_LIMITS.map((c) => `<button type="button" class="ta-pause-fps__btn" data-fps-cap="${c}" aria-pressed="${c === getFpsCap()}">${c === 0 ? 'MAX' : c}</button>`).join('');
    this.pause.id = 'pause';
    this.pause.innerHTML = `<div class="box plate"><div class="hazard"></div><h2>PAUSED</h2><div class="ta-pause-fps"><div class="ta-pause-fps__label">MAX FPS</div><div class="ta-pause-fps__options">${fpsBtns}</div></div><button class="btn btn-primary" id="p-resume">Resume</button><button class="btn btn-ghost" id="p-return">Return to orbit</button></div>`;
    parent.appendChild(this.pause);
    const syncFps = (cap = getFpsCap()) => {
      this.pause.querySelectorAll<HTMLButtonElement>('[data-fps-cap]').forEach((b) => {
        b.setAttribute('aria-pressed', String(Number(b.dataset.fpsCap) === cap));
      });
    };
    this.pause.querySelectorAll<HTMLButtonElement>('[data-fps-cap]').forEach((b) => {
      b.onclick = () => {
        setFpsCap(Number(b.dataset.fpsCap) as typeof FPS_LIMITS[number]);
        syncFps();
      };
    });
    this.offFpsCap = onFpsCapChange((cap) => syncFps(cap));
    (this.pause.querySelector('#p-resume') as HTMLElement).onclick = cb.onResume;
    (this.pause.querySelector('#p-return') as HTMLElement).onclick = cb.onReturn;
    for (const id of ['energy', 'metal', 'water', 'bio']) this.res[id] = this.el.querySelector('#r-' + id)!;
  }
  show() { requestAnimationFrame(() => this.el.classList.add('on')); }
  setResources(r: { energy: number; metal: number; water: number; bio: number }) {
    this.res.energy.textContent = String(Math.floor(r.energy)); this.res.metal.textContent = String(Math.floor(r.metal));
    this.res.water.textContent = String(Math.floor(r.water)); this.res.bio.textContent = String(Math.floor(r.bio));
  }
  updateFromLedger(view: unknown) {
    const v = (view ?? {}) as Record<string, unknown>;
    const colonies = Array.isArray(v.colonies) ? v.colonies : [];
    const col = (colonies[0] ?? v.colony ?? v) as Record<string, unknown>;
    const stock = ((col.stock ?? v.stock ?? {}) as Record<string, number>);
    const caps = ((col.caps ?? v.caps ?? {}) as Record<string, number>);
    const prod = (col.production ?? v.production ?? {}) as Record<string, unknown>;
    const famIncome = ((prod.familyIncomePerS ?? {}) as Record<string, number>);
    const subIncome = ((prod.incomePerS ?? {}) as Record<string, number>);
    const blobs = (v.blobs ?? {}) as Record<string, unknown>;
    const powerBlob = (blobs.power ?? {}) as Record<string, unknown>;
    const byColony = (powerBlob.byColony ?? {}) as Record<number, unknown>;
    const power = (col.power ?? byColony[0] ?? v.power) as Record<string, unknown> | undefined;

    this.updateFamily('metals', ['metals.t1', 'metals.t2', 'metals.t3'], stock, caps, famIncome, subIncome);
    this.updateFamily('minerals', ['minerals.t1', 'minerals.t2', 'minerals.t3'], stock, caps, famIncome, subIncome);
    this.updateFamily('bio', ['bio.water', 'bio.biomass', 'bio.t2', 'bio.t3'], stock, caps, famIncome, subIncome);

    if (power && typeof power.supply === 'number') {
      const sup = Math.round(Number(power.supply));
      const dem = Math.round(Number(power.demand ?? 0));
      const net = Math.round(Number(power.net ?? (sup - dem)));
      this.res.energy.textContent = `+${sup} / −${dem}`;
      const rateEl = this.el.querySelector('#r-energy-rate');
      if (rateEl) rateEl.textContent = `${net >= 0 ? '+' : ''}${net} E/s`;
    }
  }
  setLedgerView(view: unknown) {
    this.updateFromLedger(view);
  }
  private updateFamily(
    family: 'metals' | 'minerals' | 'bio',
    keys: readonly string[],
    stock: Record<string, number>,
    caps: Record<string, number>,
    famIncome: Record<string, number>,
    subIncome: Record<string, number>,
  ) {
    let totStock = 0;
    for (const k of keys) totStock += (stock[k] ?? 0);
    const cap = typeof caps[family] === 'number' ? caps[family] : 500;
    const income = typeof famIncome[family] === 'number' ? famIncome[family] : 0;
    const isCapped = cap > 0 && totStock >= cap - 1e-6;

    const chip = this.el.querySelector(`#chip-${family}`) as HTMLElement | null;
    if (chip) {
      chip.setAttribute('data-capped', String(isCapped));
      chip.classList.toggle('ta-res-chip--capped', isCapped);
    }
    const stockEl = this.el.querySelector(family === 'metals' ? '#r-metal' : family === 'minerals' ? '#r-mineral' : '#r-bio');
    if (stockEl) stockEl.textContent = `${Math.floor(totStock)} / ${Math.floor(cap)}`;

    const rateEl = this.el.querySelector(`#r-${family}-rate`);
    if (rateEl) rateEl.textContent = `${income >= 0 ? '+' : ''}${income.toFixed(1)}/s`;

    const breakdownEl = this.el.querySelector(`#r-${family}-breakdown`) as HTMLElement | null;
    if (breakdownEl) {
      breakdownEl.replaceChildren();
      for (const k of keys) {
        const val = Math.floor(stock[k] ?? 0);
        const rate = (subIncome[k] ?? 0).toFixed(1);
        const isLocked = !['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'].includes(k) && val <= 0 && Number(rate) <= 0;
        const row = document.createElement('div');
        row.className = 'ta-res-breakdown__row' + (isLocked ? ' ta-res-tier--locked' : '');
        row.dataset.locked = String(isLocked);
        row.dataset.res = k;
        row.innerHTML = `<span class="ta-res-breakdown__name">${k}</span><span class="ta-res-breakdown__amount">${val}</span><span class="ta-res-breakdown__rate">${Number(rate) >= 0 ? '+' : ''}${rate}/s</span>`;
        breakdownEl.appendChild(row);
      }
    }
  }
  setPaused(p: boolean) { this.pause.classList.toggle('on', p); }
  get paused() { return this.pause.classList.contains('on'); }
  dispose() { this.offFpsCap(); this.el.remove(); this.pause.remove(); }
}
