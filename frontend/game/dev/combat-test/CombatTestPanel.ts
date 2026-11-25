import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { OnlineSession } from '../../app/online/OnlineSession';
import { setGameInputBlocked } from '../../core/input/gameInputBlock';
import type { ClientView } from '../../store/replica/viewCodec';
import {
  COMBAT_SPAWN_PRESETS,
  COMBAT_TEST_MAP_SPECS,
  type CombatSpawnPreset,
  type CombatTestMapSpec,
} from './catalog';
import {
  bindCombatTestPlacement,
  dispatchAllHivesMode,
  dispatchCombatTestSpawn,
  dispatchInsectWave,
  dispatchRefillAndReveal,
} from './panelActions';
import { summarizeRoster, type RosterSnapshot } from './roster';

export interface CombatTestPanelOptions {
  readonly root: HTMLElement;
  readonly activeSpec: CombatTestMapSpec;
  readonly session: OnlineSession;
  readonly onSwitchBiome: (kind: PlanetKind) => void;
  readonly onResetMap: () => void;
}

export class CombatTestPanel {
  private readonly topbarEl: HTMLElement;
  private readonly dockEl: HTMLElement;
  private readonly dockBodyEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly armedBannerEl: HTMLElement;
  private readonly ownerSelectEl: HTMLSelectElement;
  private readonly presetButtons = new Map<string, HTMLButtonElement>();
  private readonly cleanups: Array<() => void> = [];

  private armedPreset: CombatSpawnPreset | null = null;
  private spawnCount = 1;
  private selectedOwner = 0;
  private warpFactor = 1;
  private insectAggressive = false;
  private collapsed = false;
  private lastRoster: RosterSnapshot = summarizeRoster(null);

  constructor(private readonly opts: CombatTestPanelOptions) {
    this.topbarEl = document.createElement('section');
    this.topbarEl.className = 'ta-ct-topbar plate-sm';
    this.topbarEl.dataset.testid = 'combat-test-topbar';
    this.topbarEl.setAttribute('role', 'toolbar');
    this.topbarEl.setAttribute('aria-label', 'Combat test controls');

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'ta-ct-stats';

    this.dockEl = document.createElement('aside');
    this.dockEl.className = 'ta-ct-dock plate-sm';
    this.dockEl.dataset.testid = 'combat-test-dock';
    this.dockEl.dataset.collapsed = 'false';

    this.dockBodyEl = document.createElement('div');
    this.ownerSelectEl = document.createElement('select');
    this.ownerSelectEl.className = 'ta-ct-select plate-sm';
    this.ownerSelectEl.dataset.testid = 'combat-test-owner';
    this.ownerSelectEl.setAttribute('aria-label', 'Spawn team');

    this.armedBannerEl = document.createElement('div');
    this.armedBannerEl.className = 'ta-ct-armed-banner plate-sm';
    this.armedBannerEl.hidden = true;

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'ta-ct-status plate-sm';
    this.statusEl.dataset.testid = 'combat-test-status';
    this.statusEl.textContent = 'Ready · Select any unit/building to place on map';

    this.buildTopbar();
    this.buildDock();
    this.bindEvents();
    this.opts.root.append(this.topbarEl, this.dockEl);
    this.syncFromView(this.opts.session.store.latest);
  }

  private pill(label: string, onClick: () => void, attrs: { active?: boolean; tone?: string; testId?: string } = {}): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ta-ct-pill';
    btn.textContent = label;
    if (attrs.active !== undefined) {
      btn.dataset.active = String(attrs.active);
      btn.setAttribute('aria-pressed', String(attrs.active));
    }
    if (attrs.tone) btn.dataset.tone = attrs.tone;
    if (attrs.testId) btn.dataset.testid = attrs.testId;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private buildTopbar(): void {
    const title = document.createElement('span');
    title.className = 'ta-ct-title';
    title.textContent = `COMBAT ARENA · R${this.opts.activeSpec.radius} · NO HQ · PVP OFF`;

    const biomeGroup = document.createElement('div');
    biomeGroup.className = 'ta-ct-group';
    for (const spec of COMBAT_TEST_MAP_SPECS) {
      biomeGroup.appendChild(
        this.pill(spec.shortLabel, () => this.opts.onSwitchBiome(spec.kind), {
          active: spec.kind === this.opts.activeSpec.kind,
          testId: `biome-${spec.kind}`,
        }),
      );
    }

    let fullVision = this.opts.session.isFullVision?.() ?? true;
    const visionBtn = this.pill(
      fullVision ? 'VISION: ALL' : 'VISION: REAL FOV',
      () => {
        fullVision = !fullVision;
        this.opts.session.setFullVision?.(fullVision);
        visionBtn.dataset.active = String(fullVision);
        visionBtn.setAttribute('aria-pressed', String(fullVision));
        visionBtn.textContent = fullVision ? 'VISION: ALL' : 'VISION: REAL FOV';
        this.setStatus(fullVision ? 'Full map visibility ON (all bots & hives visible)' : 'Real Player 0 FoV visibility ON');
      },
      { active: fullVision, tone: 'info', testId: 'combat-test-vision' },
    );

    const actionsGroup = document.createElement('div');
    actionsGroup.className = 'ta-ct-group';
    actionsGroup.append(
      this.pill('RESET', () => this.opts.onResetMap(), { tone: 'danger', testId: 'combat-test-reset' }),
      this.pill('REFILL+REVEAL', () => this.refillAndReveal(), { tone: 'info', testId: 'combat-test-reveal' }),
      visionBtn,
      this.pill('STAGING', () => this.jumpTo(this.lastRoster.stagingTile, 'player staging')),
      this.pill('BOT BASE', () => this.jumpTo(this.lastRoster.firstBotTile, 'nearest bot colony')),
      this.pill('INSECT HIVE', () => this.jumpTo(this.lastRoster.firstHiveTile, 'nearest insect hive')),
    );

    const speedGroup = document.createElement('div');
    speedGroup.className = 'ta-ct-group';
    const speedBtns: HTMLButtonElement[] = [];
    for (const k of [1, 2, 4, 8]) {
      const btn = this.pill(`${k}x`, () => {
        void this.setWarp(k);
        for (const b of speedBtns) {
          const on = b === btn;
          b.dataset.active = String(on);
          b.setAttribute('aria-pressed', String(on));
        }
      }, { active: k === this.warpFactor, testId: `speed-${k}x` });
      speedBtns.push(btn);
      speedGroup.appendChild(btn);
    }

    const statsGroup = document.createElement('div');
    statsGroup.className = 'ta-ct-group';
    statsGroup.appendChild(this.statsEl);

    this.topbarEl.append(title, biomeGroup, actionsGroup, speedGroup, statsGroup);
  }

  private buildDock(): void {
    const head = document.createElement('div');
    head.className = 'ta-ct-dock-head';
    const dt = document.createElement('span');
    dt.className = 'ta-ct-dock-title';
    dt.textContent = 'COMBAT SPAWNER';
    const collapseBtn = this.pill('HIDE', () => {
      this.collapsed = !this.collapsed;
      this.dockEl.dataset.collapsed = String(this.collapsed);
      this.dockBodyEl.hidden = this.collapsed;
      collapseBtn.textContent = this.collapsed ? 'SPAWN' : 'HIDE';
    }, { tone: 'info' });
    head.append(dt, collapseBtn);

    const ownerSec = document.createElement('div');
    ownerSec.className = 'ta-ct-row';
    const playerOpt = document.createElement('option');
    playerOpt.value = '0';
    playerOpt.textContent = 'Team: Player (Col 0)';
    this.ownerSelectEl.appendChild(playerOpt);
    this.ownerSelectEl.addEventListener('change', () => {
      this.selectedOwner = Number(this.ownerSelectEl.value) || 0;
    });

    const qtyGroup = document.createElement('div');
    qtyGroup.className = 'ta-ct-row';
    const qtyBtns: HTMLButtonElement[] = [];
    for (const n of [1, 3, 5]) {
      const b = this.pill(`x${n}`, () => {
        this.spawnCount = n;
        for (const qb of qtyBtns) qb.dataset.active = String(qb === b);
      }, { active: n === this.spawnCount, testId: `qty-${n}` });
      qtyBtns.push(b);
      qtyGroup.appendChild(b);
    }
    ownerSec.append(this.ownerSelectEl, qtyGroup);

    this.dockBodyEl.append(ownerSec);
    this.appendCategory('Battle Units', 'battle-unit');
    this.appendCategory('Battle Buildings (Active Instantly)', 'battle-building');
    this.appendCategory('Insects & Hives', 'insect-hive');
    this.appendCategory('Support Units & Infra', 'support');

    const faunaRow = document.createElement('div');
    faunaRow.className = 'ta-ct-sec ta-ct-row';
    const aggBtn = this.pill(
      this.insectAggressive ? 'Hives: AGGRESSIVE' : 'Hives: PASSIVE',
      () => {
        this.insectAggressive = !this.insectAggressive;
        aggBtn.dataset.active = String(this.insectAggressive);
        aggBtn.textContent = this.insectAggressive ? 'Hives: AGGRESSIVE' : 'Hives: PASSIVE';
        void this.setAllHivesMode(this.insectAggressive ? 'aggressive' : 'passive');
      },
      { active: this.insectAggressive, testId: 'combat-test-aggression' },
    );
    const raidBtn = this.pill('SEND INSECT WAVE', () => { void this.triggerFaunaWave(); }, {
      tone: 'danger',
      testId: 'combat-test-wave',
    });
    faunaRow.append(aggBtn, raidBtn);

    this.dockBodyEl.append(faunaRow, this.armedBannerEl, this.statusEl);
    this.dockEl.append(head, this.dockBodyEl);
  }

  private appendCategory(title: string, mode: 'battle-unit' | 'battle-building' | 'insect-hive' | 'support'): void {
    const items = COMBAT_SPAWN_PRESETS.filter((p) => {
      if (mode === 'battle-unit') return p.category === 'battle-unit';
      if (mode === 'battle-building') return p.category === 'battle-building';
      if (mode === 'insect-hive') return p.category === 'insect' || p.category === 'hive';
      return p.category === 'support-unit' || p.category === 'support-building';
    });
    const sec = document.createElement('div');
    sec.className = 'ta-ct-sec';
    const lbl = document.createElement('div');
    lbl.className = 'ta-ct-sec-label';
    lbl.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'ta-ct-grid';
    for (const preset of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-ct-item';
      btn.title = preset.hint;
      btn.dataset.testid = `spawn-preset-${preset.id}`;
      const code = document.createElement('span');
      code.className = 'ta-ct-item-code';
      code.textContent = preset.shortCode;
      const name = document.createElement('span');
      name.className = 'ta-ct-item-name';
      name.textContent = preset.label;
      btn.append(code, name);
      btn.addEventListener('click', () => this.toggleArmedPreset(preset));
      this.presetButtons.set(preset.id, btn);
      grid.appendChild(btn);
    }
    sec.append(lbl, grid);
    this.dockBodyEl.appendChild(sec);
  }

  private toggleArmedPreset(preset: CombatSpawnPreset): void {
    if (this.armedPreset?.id === preset.id) {
      this.disarm();
      return;
    }
    this.armedPreset = preset;
    setGameInputBlocked('combat-test-spawn', true);
    for (const [id, btn] of this.presetButtons) btn.dataset.armed = String(id === preset.id);
    this.armedBannerEl.replaceChildren();
    const txt = document.createElement('span');
    txt.textContent = `CLICK MAP TO SPAWN: ${preset.label} (${preset.commandKind === 'dev.spawnbuilding' || preset.category === 'hive' ? '1x' : `x${this.spawnCount}`})`;
    const row = document.createElement('div');
    row.className = 'ta-ct-row';
    row.append(
      this.pill('Drop @ View Center', () => {
        const picked = typeof window !== 'undefined'
          ? this.opts.session.pickAt(window.innerWidth / 2, window.innerHeight / 2)
          : null;
        const t = picked ?? (this.lastRoster.stagingTile.q !== 0 || this.lastRoster.stagingTile.r !== 0
          ? this.lastRoster.stagingTile
          : this.opts.session.cameraTargetTile);
        this.spawnAt(preset, t.q, t.r, undefined, true);
      }, { active: true, testId: 'combat-test-drop-center' }),
      this.pill('Cancel (Esc)', () => this.disarm()),
    );
    this.armedBannerEl.append(txt, row);
    this.armedBannerEl.hidden = false;
    this.opts.session.hudServices?.mouseCursor?.refresh();
    this.setStatus(`Armed ${preset.label}: click ground to place`);
  }

  disarm(): void {
    this.armedPreset = null;
    setGameInputBlocked('combat-test-spawn', false);
    for (const btn of this.presetButtons.values()) btn.dataset.armed = 'false';
    this.armedBannerEl.hidden = true;
    this.opts.session.hudServices?.mouseCursor?.refresh();
  }

  private commandContext() {
    return {
      session: this.opts.session,
      setStatus: (msg: string) => this.setStatus(msg),
    };
  }

  spawnAt(preset: CombatSpawnPreset, q: number, r: number, ownerOverride?: number, fallbackNear = false): void {
    dispatchCombatTestSpawn(this.commandContext(), {
      preset,
      q,
      r,
      owner: ownerOverride ?? this.selectedOwner,
      count: this.spawnCount,
      insectAggressive: this.insectAggressive,
      fallbackNear,
    });
  }

  private bindEvents(): void {
    const unsubView = this.opts.session.store.onView((view) => this.syncFromView(view));
    const unbindPlacement = bindCombatTestPlacement({
      session: this.opts.session,
      getArmed: () => this.armedPreset,
      disarm: () => this.disarm(),
      spawnAt: (preset, q, r) => this.spawnAt(preset, q, r),
      setStatus: (msg) => this.setStatus(msg),
    });
    this.cleanups.push(unsubView, unbindPlacement);
  }

  private syncFromView(view: ClientView | null | undefined): void {
    const r = summarizeRoster(view);
    this.lastRoster = r;
    const mkStat = (prefix: string, val: string) => {
      const s = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = val;
      s.append(`${prefix} `, b);
      return s;
    };
    this.statsEl.replaceChildren(
      mkStat('YOU', `${r.playerUnits}u/${r.playerBuildings}b`),
      mkStat('BOTS', `${r.botColonies.length} (${r.botEntities})`),
      mkStat('BUGS', `${r.insects} (${r.hives} hives)`),
    );
    const sig = r.botColonies.map((b) => `${b.index}:${b.name}`).join('|');
    if (this.ownerSelectEl.dataset.sig !== sig) {
      this.ownerSelectEl.dataset.sig = sig;
      const prev = String(this.selectedOwner);
      this.ownerSelectEl.replaceChildren();
      const pOpt = document.createElement('option');
      pOpt.value = '0';
      pOpt.textContent = 'Team: Player (Col 0)';
      this.ownerSelectEl.appendChild(pOpt);
      for (const b of r.botColonies) {
        const opt = document.createElement('option');
        opt.value = String(b.index);
        opt.textContent = `Team: ${b.name} (Col ${b.index})`;
        this.ownerSelectEl.appendChild(opt);
      }
      this.ownerSelectEl.value = [...this.ownerSelectEl.options].some((o) => o.value === prev) ? prev : '0';
      this.selectedOwner = Number(this.ownerSelectEl.value) || 0;
    }
  }

  private jumpTo(tile: { q: number; r: number } | null, label: string): void {
    if (!tile) {
      this.setStatus(`No ${label} found on map`);
      return;
    }
    this.opts.session.cameraTargetTile = { q: tile.q, r: tile.r };
    this.opts.session.focusTile(tile.q, tile.r, true);
    this.setStatus(`Camera centered on ${label} (${tile.q}, ${tile.r})`);
  }

  private async setAllHivesMode(mode: 'passive' | 'aggressive'): Promise<void> {
    await dispatchAllHivesMode(this.commandContext(), mode);
  }

  private async triggerFaunaWave(): Promise<void> {
    await dispatchInsectWave(this.commandContext(), this.lastRoster);
  }

  private async refillAndReveal(): Promise<void> {
    await dispatchRefillAndReveal(this.commandContext());
  }

  private async setWarp(k: number): Promise<void> {
    this.warpFactor = k;
    const t = this.opts.session.transport as { devServer?: (name: string, args?: unknown) => Promise<unknown> };
    const planetId = this.opts.session.store.currentPlanetId() || this.opts.session.planetId;
    if (t.devServer && planetId) {
      try {
        await t.devServer('warp', { planetId, k });
        this.setStatus(`Simulation speed set to ${k}x`);
      } catch (e) {
        this.setStatus(`Speed ${k}x failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  dispose(): void {
    setGameInputBlocked('combat-test-spawn', false);
    for (const fn of this.cleanups.splice(0)) fn();
    this.topbarEl.remove();
    this.dockEl.remove();
  }
}
