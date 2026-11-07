import './insect-controls.css';
import { esc } from '../dom';
import type { FaunaSceneStats } from '../content/FaunaSceneHost';
import type { FaunaMode, FaunaSceneKind, PgState } from '../state';

export interface FaunaScenePanelHandlers {
  onScene(scene: FaunaSceneKind | null): void;
  onMode(mode: FaunaMode): void;
  onSeed(seed: number): void;
  onPauseToggle(): void;
  onStep(ticks?: number): void;
  onReset(): void;
  onAcidPreview(): void;
}

const SCENE_BUTTONS: ReadonlyArray<{ key: FaunaSceneKind; label: string }> = [
  { key: 'blackAnt', label: 'ANT HIVE' },
  { key: 'blueBeetle', label: 'BEETLE NEST' },
  { key: 'greenSpitter', label: 'SPITTER HIVE' },
  { key: 'mixed', label: 'MIXED' },
];

/**
 * Faction-Plate Hive-Life Playground panel (`fauna-hives-spec.md` §4).
 * Provides insect attack direction, legacy life/gallery modes, deterministic stepping, and acid preview.
 */
export class FaunaScenePanel {
  private root!: HTMLElement;

  constructor(
    private state: PgState,
    private getStats: () => FaunaSceneStats,
    private on: FaunaScenePanelHandlers,
  ) {}

  build(): void {
    const mount = document.querySelector<HTMLElement>('[data-side-pane="hive"]');
    if (!mount) throw new Error('Missing sidebar pane [data-side-pane="hive"]. Call Sidebar.build() before FaunaScenePanel.build().');
    const el = document.createElement('section');
    el.id = 'fauna-panel';
    el.className = 'panel plate-sm fp-panel';
    el.setAttribute('data-testid', 'pg-fauna-panel');
    el.innerHTML = `
      <div class="fp-head">
        <span class="fp-badge" id="fp-mode-badge" data-fauna-badge>NEUTRAL</span>
      </div>
      <div class="fp-scenes" id="fp-scene-btns">
        ${SCENE_BUTTONS.map(
          (b) =>
            `<button type="button" class="pg-btn fp-scene-btn" data-v="${b.key}" data-fauna-scene="${b.key}">${b.label}</button>`,
        ).join('')}
      </div>
      <div class="fp-body" id="fp-body">
        <fieldset class="fp-attack-direction" aria-label="Attack direction">
          <legend>ATTACK DIRECTION</legend>
          <label class="pg-btn fp-attack-choice"><input type="radio" name="fauna-attack" value="bugs" data-fauna-attack="bugs" /> Bugs attack</label>
          <label class="pg-btn fp-attack-choice"><input type="radio" name="fauna-attack" value="robots" data-fauna-attack="robots" /> Robot attacks</label>
        </fieldset>
        <div class="fp-controls">
          <button type="button" class="pg-btn" id="fp-mode-btn" data-fauna-mode="passive" title="Toggle Passive (Neutral) vs Aggressive raid mode">PASSIVE</button>
          <button type="button" class="pg-btn" data-fauna-range="gallery" title="Stationary turrets and units, each with its own bug target">SHOOTING GALLERY</button>
          <label class="fp-seed-lbl">SEED
            <input type="number" class="fp-seed-input" id="fp-seed-input" data-fauna-seed value="${this.state.faunaSeed}" step="1" />
          </label>
        </div>
        <div class="fp-transport">
          <button type="button" class="pg-btn" id="fp-pause-btn" data-fauna-pause>PAUSE</button>
          <button type="button" class="pg-btn" id="fp-step-btn" data-fauna-step>+1 STEP</button>
          <button type="button" class="pg-btn" id="fp-reset-btn" data-fauna-reset>RESET</button>
          <button type="button" class="pg-btn fp-acid-btn" id="fp-acid-btn" data-fauna-acid>ACID PREVIEW</button>
        </div>
        <div class="fp-stats" id="fp-stats" data-fauna-stats></div>
      </div>`;
    mount.appendChild(el);
    this.root = el;
    this.bindEvents();
    this.render();
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-fauna-scene]').forEach((btn) => {
      btn.onclick = () => {
        const raw = btn.dataset.faunaScene;
        this.on.onScene(raw === 'off' || !raw ? null : (raw as FaunaSceneKind));
      };
    });

    const modeBtn = this.root.querySelector<HTMLButtonElement>('[data-fauna-mode]')!;
    modeBtn.onclick = () => {
      const next: FaunaMode = this.state.faunaMode === 'passive' ? 'aggressive' : 'passive';
      this.on.onMode(next);
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-fauna-range]').forEach((btn) => {
      btn.onclick = () => {
        const mode = btn.dataset.faunaRange;
        if (mode === 'gallery' || mode === 'turrets' || mode === 'units' || mode === 'bugs') this.on.onMode(mode);
      };
    });

    this.root.querySelectorAll<HTMLInputElement>('[data-fauna-attack]').forEach((input) => {
      input.onchange = () => {
        if (input.checked) this.on.onMode(input.value as 'bugs' | 'robots');
      };
    });

    const seedInput = this.root.querySelector<HTMLInputElement>('[data-fauna-seed]')!;
    seedInput.onchange = () => {
      const parsed = Number(seedInput.value);
      if (Number.isFinite(parsed)) {
        this.on.onSeed(Math.trunc(parsed));
      }
    };

    this.root.querySelector<HTMLButtonElement>('[data-fauna-pause]')!.onclick = () => this.on.onPauseToggle();
    this.root.querySelector<HTMLButtonElement>('[data-fauna-step]')!.onclick = () => this.on.onStep(1);
    this.root.querySelector<HTMLButtonElement>('[data-fauna-reset]')!.onclick = () => this.on.onReset();
    this.root.querySelector<HTMLButtonElement>('[data-fauna-acid]')!.onclick = () => this.on.onAcidPreview();
  }

  render(): void {
    if (!this.root) return;
    const stats = this.getStats();
    const activeKey = this.state.faunaScene ?? 'off';
    this.root.querySelectorAll<HTMLButtonElement>('[data-fauna-scene]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.faunaScene === activeKey);
    });

    const body = this.root.querySelector<HTMLElement>('#fp-body')!;
    body.hidden = this.state.faunaScene === null;

    const badge = this.root.querySelector<HTMLElement>('#fp-mode-badge')!;
    const isAggro = this.state.faunaMode === 'aggressive';
    badge.textContent = this.state.faunaScene === null ? 'STANDBY' : stats.modeLabel;
    badge.classList.toggle('aggro', this.state.faunaMode !== 'passive' && this.state.faunaScene !== null);

    const modeBtn = this.root.querySelector<HTMLButtonElement>('[data-fauna-mode]')!;
    modeBtn.dataset.faunaMode = this.state.faunaMode;
    modeBtn.textContent = `MODE: ${stats.modeLabel === 'NEUTRAL' ? 'PASSIVE' : stats.modeLabel}`;
    modeBtn.classList.toggle('on', isAggro);
    this.root.querySelectorAll<HTMLButtonElement>('[data-fauna-range]').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.faunaRange === this.state.faunaMode);
    });

    const seedInput = this.root.querySelector<HTMLInputElement>('[data-fauna-seed]')!;
    if (document.activeElement !== seedInput) {
      seedInput.value = String(this.state.faunaSeed);
    }

    this.root.querySelectorAll<HTMLInputElement>('[data-fauna-attack]').forEach((input) => {
      input.checked = input.value === this.state.faunaMode;
      input.parentElement?.classList.toggle('on', input.checked);
    });

    const pauseBtn = this.root.querySelector<HTMLButtonElement>('[data-fauna-pause]')!;
    pauseBtn.textContent = stats.paused ? 'PLAY' : 'PAUSE';
    pauseBtn.classList.toggle('on', stats.paused);

    this.renderStats(stats);
  }

  renderStats(stats = this.getStats()): void {
    if (!this.root) return;
    const statsEl = this.root.querySelector<HTMLElement>('[data-fauna-stats]');
    if (!statsEl) return;
    const hiveRows = stats.hives
      .map((h) => {
        const target = h.targetColony ? `→ ${esc(h.targetColony)} (next ${h.nextWaveTicks}t)` : 'home wander';
        return `<div class="fp-hive-row">
          <span><b>${esc(h.hiveId)}</b> · ${esc(h.species)}</span>
          <span>${h.residents}/${h.maxResidents} · W${h.waveCount} · ${target}</span>
        </div>`;
      })
      .join('');
    statsEl.innerHTML = `
      <div class="fp-stat-grid">
        <span>TICK <b>${stats.tick}</b></span>
        <span>POP <b>${stats.populationCount} / ${stats.maxPopulation}</b></span>
        <span>WAVES <b>${stats.waveCount}</b></span>
        <span>MODE <b>${stats.modeLabel}</b></span>
      </div>
      ${hiveRows}
      <div class="fp-animation-states" data-fauna-animation-states>${(stats.animations ?? []).map((animation) => {
        const species = stats.bugs.find(bug => bug.bugId.endsWith(`:${animation.id}`))?.species ?? 'insect';
        return `<div>#${animation.id} ${esc(species)} · <b>${esc(animation.state)}</b> ${Math.round(animation.phase * 100)}%${animation.retired ? ' · removed' : ''}</div>`;
      }).join('')}</div>`;
  }
}
