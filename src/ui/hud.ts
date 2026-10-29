import type { DescentTelemetry } from '../descent/types';

/** Cinematic descent overlay (telemetry, letterbox, progress, skip hint). */
export class DescentHud {
  readonly el = document.createElement('div');
  private q: Record<string, HTMLElement> = {};
  constructor(parent: HTMLElement) {
    this.el.id = 'descent'; this.el.className = 'ui-layer';
    this.el.innerHTML = `<div class="lb top"></div><div class="lb bot"></div>
      <div class="telemetry plate-sm">
        <div><span class="k">ALTITUDE</span><b id="d-alt">—</b> km</div>
        <div><span class="k">SPEED</span><b id="d-spd">—</b> km/h</div>
        <div><span class="k">G-FORCE</span><b id="d-g">—</b> g</div>
        <div><span class="k">HULL HEAT</span><span class="heat"><i id="d-heat"></i></span> <b id="d-heatp">0</b>%</div>
      </div>
      <div class="phase plate-sm" id="d-phase"></div>
      <div class="caption" id="d-cap"></div>
      <div class="progress"><i id="d-prog"></i></div>
      <div class="skip">PRESS ESC / SPACE TO SKIP</div>`;
    parent.appendChild(this.el);
    for (const id of ['alt', 'spd', 'g', 'heat', 'heatp', 'phase', 'cap', 'prog']) this.q[id] = this.el.querySelector('#d-' + id)!;
  }
  show() { requestAnimationFrame(() => this.el.classList.add('on')); }
  hide() { this.el.classList.remove('on'); }
  update(t: DescentTelemetry) {
    const f = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
    this.q.alt.textContent = f(t.altitudeKm, t.altitudeKm < 10 ? 2 : 0);
    this.q.spd.textContent = f(t.speedKmh);
    this.q.g.textContent = f(t.gForce, 1);
    this.q.heat.style.width = t.heatPct + '%';
    this.q.heatp.textContent = f(t.heatPct);
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
        <div><b id="r-energy">0</b><span>ENERGY</span></div><div><b id="r-metal">0</b><span>METAL</span></div>
        <div><b id="r-water">0</b><span>WATER</span></div><div><b id="r-bio">0</b><span>BIOMASS</span></div>
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
  setPaused(p: boolean) { this.pause.classList.toggle('on', p); }
  get paused() { return this.pause.classList.contains('on'); }
  dispose() { this.el.remove(); this.pause.remove(); }
}
