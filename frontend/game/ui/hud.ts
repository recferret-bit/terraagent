import type { DescentTelemetry } from '@terra/render/descent/types';

/** Cinematic descent overlay (telemetry, letterbox, progress, skip hint). */
export class DescentHud {
  readonly el = document.createElement('div');
  private q: Record<string, HTMLElement> = {};
  private lastTemp = -40;
  constructor(parent: HTMLElement) {
    this.el.id = 'descent'; this.el.className = 'ui-layer';
    this.el.innerHTML = `<div class="lb top"></div><div class="lb bot"></div>
      <div class="telemetry plate-sm">
        <div><span class="k">ALTITUDE</span><b id="d-alt">—</b> km</div>
        <div><span class="k">SPEED</span><b id="d-spd">—</b> km/h</div>
        <div><span class="k">G-FORCE</span><b id="d-g">—</b> g</div>
        <div class="temp" id="d-temp"><span class="k">HULL TEMP</span><b id="d-tc">−40</b> <span class="u">°C</span><span class="trend" id="d-trend"></span></div>
      </div>
      <div class="phase plate-sm" id="d-phase"></div>
      <div class="caption" id="d-cap"></div>
      <div class="progress"><i id="d-prog"></i></div>
      <div class="skip">PRESS ESC / SPACE TO SKIP</div>`;
    parent.appendChild(this.el);
    for (const id of ['alt', 'spd', 'g', 'temp', 'tc', 'trend', 'phase', 'cap', 'prog']) this.q[id] = this.el.querySelector('#d-' + id)!;
  }
  show() { requestAnimationFrame(() => this.el.classList.add('on')); }
  hide() { this.el.classList.remove('on'); }
  update(t: DescentTelemetry) {
    const f = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
    this.q.alt.textContent = f(t.altitudeKm, t.altitudeKm < 10 ? 2 : 0);
    this.q.spd.textContent = f(t.speedKmh);
    this.q.g.textContent = f(t.gForce, 1);
    // hull temperature in °C: colour band + rising/falling arrow (replaces the old heat bar)
    const c = Math.round(t.hullTempC);
    this.q.tc.textContent = (c < 0 ? '−' : '') + f(Math.abs(c));
    this.q.temp.dataset.band = c > 1100 ? 'crit' : c > 450 ? 'hot' : c > 60 ? 'warm' : 'cold';
    const d = c - this.lastTemp; this.lastTemp = c;
    this.q.trend.textContent = d > 2 ? '▲' : d < -2 ? '▼' : '';
    this.q.phase.textContent = t.phase;
    this.q.cap.textContent = t.caption;
    this.q.prog.style.width = (t.progress * 100).toFixed(1) + '%';
  }
  dispose() { this.el.remove(); }
}

/** Minimal gameplay HUD + pause menu. */
export class GameHud {
  readonly el = document.createElement('div');
  readonly pause = document.createElement('div');
  private res: Record<string, HTMLElement> = {};
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
    this.pause.id = 'pause';
    this.pause.innerHTML = `<div class="box plate"><div class="hazard"></div><h2>PAUSED</h2><button class="btn btn-primary" id="p-resume">Resume</button><button class="btn btn-ghost" id="p-return">Return to orbit</button></div>`;
    parent.appendChild(this.pause);
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
  dispose() { this.el.remove(); this.pause.remove(); }
}
