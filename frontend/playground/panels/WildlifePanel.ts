import { BIRDS_BY_BIOME, LAND_ANIMALS_BY_BIOME } from '@terra/render/biosphere';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { esc } from '../dom';
import { WILDLIFE_STORYBOOK_LEVELS, type WildlifeSceneStats } from '../content/WildlifeSceneHost';
import type { PgState } from '../state';

export interface WildlifePanelHandlers {
  onScene(kind: PlanetKind | null): void;
  onHour(hour: number): void;
  onPauseToggle(): void;
  onStep(): void;
  onScare(): void;
  onReset(): void;
}

const HOUR_PRESETS: ReadonlyArray<{ hour: number; label: string }> = [
  { hour: 6, label: '06:00' },
  { hour: 10, label: '10:00' },
  { hour: 15, label: '15:00' },
  { hour: 22, label: '22:00' },
];

/**
 * Biome Wildlife Ecosystem panel mounted inside the dedicated Wildlife sidebar pane (`[data-side-pane="wildlife"]`).
 * Provides 3 storybook planet levels (one per planet type: `forestRock`, `oceanForest`, `dune`).
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
    const mount = document.querySelector<HTMLElement>('[data-side-pane="wildlife"]');
    if (!mount) throw new Error('Missing sidebar pane [data-side-pane="wildlife"]. Call Sidebar.build() before WildlifePanel.build().');
    const el = document.createElement('section');
    el.id = 'wildlife-panel';
    el.className = 'panel plate-sm fp-panel';
    el.setAttribute('data-testid', 'pg-wildlife-panel');
    el.innerHTML = `
      <div class="fp-head">
        <span class="fp-badge" data-wildlife-badge>WILDLIFE</span>
      </div>
      <div class="fp-scenes" data-wildlife-levels>
        ${WILDLIFE_STORYBOOK_LEVELS.map(
          (b) => `<button type="button" class="pg-btn fp-scene-btn" data-wildlife-biome="${b.kind}" title="${esc(b.title)} — ${esc(b.summary)}">${b.label}</button>`,
        ).join('')}
        <button type="button" class="pg-btn fp-scene-btn" data-wildlife-biome="off">OFF</button>
      </div>
      <div class="fp-stats" data-wildlife-level-cards>
        ${WILDLIFE_STORYBOOK_LEVELS.map(
          (lvl) => `<div class="fp-hive-row fp-wildlife-card" data-wildlife-level-card="${lvl.kind}">
            <span><b>${esc(lvl.title)}</b> (${lvl.kind})<small class="fp-wildlife-summary">${esc(lvl.summary)}</small></span>
            <span>${BIRDS_BY_BIOME[lvl.kind].length} birds · ${LAND_ANIMALS_BY_BIOME[lvl.kind].length} mammals</span>
          </div>`,
        ).join('')}
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
    this.root.querySelectorAll<HTMLElement>('[data-wildlife-level-card]').forEach((card) => {
      card.onclick = () => {
        const raw = card.dataset.wildlifeLevelCard;
        if (raw) this.on.onScene(raw as PlanetKind);
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
    this.root.querySelectorAll<HTMLElement>('[data-wildlife-level-card]').forEach((card) => {
      card.classList.toggle('on', card.dataset.wildlifeLevelCard === active);
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
    if (!s.active || !s.kind) {
      box.innerHTML = '';
      return;
    }
    const birds = BIRDS_BY_BIOME[s.kind].map((b) => esc(b.label)).join(', ');
    const mammals = LAND_ANIMALS_BY_BIOME[s.kind].map((m) => esc(m.label)).join(', ');
    box.innerHTML = `
      <div><span>Level</span><strong>${esc(s.levelTitle)}</strong></div>
      <div><span>Hour</span><strong>${esc(String(Math.round(s.hour)).padStart(2, '0'))}:00</strong></div>
      <div><span>Birds</span><strong>${s.birdsTotal} (${s.birdSpecies} spp)</strong></div>
      <div><span>Mammals</span><strong>${s.landAnimalsTotal} (${s.landSpecies} spp)</strong></div>
      <div><span>Grazing / Hunt / Sleep</span><strong>${s.grazing} / ${s.hunting} / ${s.sleeping}</strong></div>
      <div><span>Fleeing</span><strong>${s.fleeing}</strong></div>
      <div class="fp-hive-row"><span><b>Avian</b></span><span>${birds}</span></div>
      <div class="fp-hive-row"><span><b>Mammals</b></span><span>${mammals}</span></div>`;
  }
}
