import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { esc } from '../dom';
import type { WildlifeSceneStats } from '../content/WildlifeSceneHost';
import type { PgState } from '../state';

export interface WildlifePanelHandlers {
  onScene(kind: PlanetKind | null): void;
  onHour(hour: number): void;
  onPauseToggle(): void;
  onStep(): void;
  onScare(): void;
  onReset(): void;
}

const BIOME_BUTTONS: ReadonlyArray<{ kind: PlanetKind; label: string }> = [
  { kind: 'forestRock', label: 'FOREST' },
  { kind: 'oceanForest', label: 'OCEAN' },
  { kind: 'dune', label: 'DUNE' },
];

const HOUR_PRESETS: ReadonlyArray<{ hour: number; label: string }> = [
  { hour: 6, label: '06:00' },
  { hour: 10, label: '10:00' },
  { hour: 15, label: '15:00' },
  { hour: 22, label: '22:00' },
];

/**
 * Biome Wildlife Ecosystem panel mounted inside the Hive & Nature sidebar pane (`[data-side-pane="hive"]`).
 * Uses Faction Plate chamfered buttons only (zero radio inputs, preserving insect-controls assertions).
 */
export class WildlifePanel {
  private root!: HTMLElement;

  constructor(
    private state: PgState,
    private getStats: () => WildlifeSceneStats,
    private on: WildlifePanelHandlers,
  ) {}

  build(): void {
    const mount = document.querySelector<HTMLElement>('[data-side-pane="hive"]');
    if (!mount) throw new Error('Missing sidebar pane [data-side-pane="hive"].');
    const el = document.createElement('section');
    el.id = 'wildlife-panel';
    el.className = 'panel plate-sm fp-panel';
    el.setAttribute('data-testid', 'pg-wildlife-panel');
    el.innerHTML = `
      <div class="fp-head">
        <span class="fp-badge" data-wildlife-badge>WILDLIFE</span>
      </div>
      <div class="fp-scenes">
        ${BIOME_BUTTONS.map(
          (b) => `<button type="button" class="pg-btn fp-scene-btn" data-wildlife-biome="${b.kind}">${b.label}</button>`,
        ).join('')}
        <button type="button" class="pg-btn fp-scene-btn" data-wildlife-biome="off">OFF</button>
      </div>
      <div class="fp-body" data-wildlife-body>
        <div class="fp-controls">
          ${HOUR_PRESETS.map(
            (h) => `<button type="button" class="pg-btn" data-wildlife-hour="${h.hour}">${h.label}</button>`,
          ).join('')}
        </div>
        <div class="fp-transport">
          <button type="button" class="pg-btn" data-wildlife-pause>PAUSE</button>
          <button type="button" class="pg-btn" data-wildlife-step>+1s STEP</button>
          <button type="button" class="pg-btn" data-wildlife-scare>SCARE</button>
          <button type="button" class="pg-btn" data-wildlife-reset>RESET</button>
        </div>
        <div class="fp-stats" data-wildlife-stats></div>
      </div>`;
    mount.appendChild(el);
    this.root = el;
    this.bindEvents();
    this.render();
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-wildlife-biome]').forEach((btn) => {
      btn.onclick = () => {
        const raw = btn.dataset.wildlifeBiome;
        this.on.onScene(!raw || raw === 'off' ? null : (raw as PlanetKind));
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-wildlife-hour]').forEach((btn) => {
      btn.onclick = () => this.on.onHour(Number(btn.dataset.wildlifeHour ?? 10));
    });
    this.root.querySelector<HTMLButtonElement>('[data-wildlife-pause]')!.onclick = () => this.on.onPauseToggle();
    this.root.querySelector<HTMLButtonElement>('[data-wildlife-step]')!.onclick = () => this.on.onStep();
    this.root.querySelector<HTMLButtonElement>('[data-wildlife-scare]')!.onclick = () => this.on.onScare();
    this.root.querySelector<HTMLButtonElement>('[data-wildlife-reset]')!.onclick = () => this.on.onReset();
  }

  render(): void {
    if (!this.root) return;
    const stats = this.getStats();
    const active = this.state.wildlife;
    this.root.querySelectorAll<HTMLButtonElement>('[data-wildlife-biome]').forEach((btn) => {
      const target = btn.dataset.wildlifeBiome;
      btn.classList.toggle('on', active === null ? target === 'off' : target === active);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-wildlife-hour]').forEach((btn) => {
      btn.classList.toggle('on', Number(btn.dataset.wildlifeHour) === Math.round(this.state.wildlifeHour));
    });
    const body = this.root.querySelector<HTMLElement>('[data-wildlife-body]')!;
    body.hidden = active === null;
    const badge = this.root.querySelector<HTMLElement>('[data-wildlife-badge]')!;
    badge.textContent = active ? `WILDLIFE · ${active.toUpperCase()}` : 'WILDLIFE · OFF';
    const pause = this.root.querySelector<HTMLButtonElement>('[data-wildlife-pause]')!;
    pause.textContent = stats.paused ? 'RESUME' : 'PAUSE';
    pause.classList.toggle('on', stats.paused);
    const scare = this.root.querySelector<HTMLButtonElement>('[data-wildlife-scare]')!;
    scare.classList.toggle('on', stats.scareTimer > 0);
    this.renderStats();
  }

  renderStats(): void {
    if (!this.root) return;
    const s = this.getStats();
    const box = this.root.querySelector<HTMLElement>('[data-wildlife-stats]')!;
    if (!s.active) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `
      <div><span>Hour</span><strong>${esc(String(Math.round(s.hour)).padStart(2, '0'))}:00</strong></div>
      <div><span>Birds</span><strong>${s.birdsTotal} (${s.birdSpecies} spp)</strong></div>
      <div><span>Mammals</span><strong>${s.landAnimalsTotal} (${s.landSpecies} spp)</strong></div>
      <div><span>Grazing / Hunt / Sleep</span><strong>${s.grazing} / ${s.hunting} / ${s.sleeping}</strong></div>
      <div><span>Fleeing</span><strong>${s.fleeing}</strong></div>`;
  }
}
