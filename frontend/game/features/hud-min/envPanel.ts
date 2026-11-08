import type { ViewColony } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import { viewColony } from '../shared/colony';
import { readDaytime } from '../shared/daytime';
import { makeDiv, makeSpan } from '../shared/dom';
import { readColonyPower } from '../shared/power';
import './envPanel.css';
import { createTerraformSlot, readColonyTerraformStats, renderTerraformBreakdown, TERRAFORM_BONUS_HINT, tierGateHint } from './terraformMeter';

/** Shown in place of a number until the first view arrives. */
const NO_DATA = '—';

export interface EnvPanelOptions {
  getColonyIndex(): number;
  /** Whether wave `wave` is on (live flags). Absent: every wave on. */
  isWaveOn?: (wave: string) => boolean;
}

/** `Wind HIGH 150%` from the grid's wind factor (1 = nominal). */
export function formatWind(wind: number): string {
  return `Wind ${wind < 1 ? 'LOW' : wind > 1 ? 'HIGH' : 'MED'} ${Math.round(wind * 100)}%`;
}

/**
 * Compact stacked environment panel under the minimap: planet time of day + daylight %, wind level (W02) and the
 * W05 Terraform meter. It was part of the top header; the header keeps resources, supply, energy and the game clock.
 */
export class EnvPanel {
  readonly el: HTMLElement;
  private readonly daytimeEl: HTMLElement;
  private readonly daytimeIcon: HTMLElement;
  private readonly daytimeClock: HTMLElement;
  private readonly daytimeLight: HTMLElement;
  private readonly windEl: HTMLElement;
  private readonly terraform = createTerraformSlot();

  constructor(parent: HTMLElement | null, private readonly opts: EnvPanelOptions) {
    this.el = makeDiv('ta-env-panel', 'hud-env');

    this.daytimeEl = makeDiv('ta-hud-min__daytime ta-env-panel__row', 'hud-daytime');
    this.daytimeEl.setAttribute('data-phase', 'day');
    this.daytimeEl.title = 'Local time · daylight (solar output)';
    this.daytimeIcon = makeSpan('ta-hud-min__daytime-icon', undefined, '☀');
    this.daytimeIcon.setAttribute('aria-hidden', 'true');
    this.daytimeClock = makeSpan('ta-hud-min__daytime-clock', 'hud-daytime-clock', NO_DATA);
    this.daytimeLight = makeSpan('ta-hud-min__daytime-light', 'hud-daytime-light', '');
    this.daytimeEl.append(this.daytimeIcon, this.daytimeClock, this.daytimeLight);

    this.windEl = makeDiv('ta-env-panel__wind ta-env-panel__row', 'hud-wind');
    this.windEl.title = 'Wind factor (wind turbine output)';
    this.windEl.hidden = true;

    this.terraform.el.classList.add('ta-env-panel__row');
    this.renderTerraform(undefined, undefined, 0);
    this.sync();
    this.el.append(this.daytimeEl, this.windEl, this.terraform.el);
    parent?.appendChild(this.el);
  }

  private gridOn(): boolean {
    return this.opts.isWaveOn?.('W02') ?? true;
  }

  private terraformOn(): boolean {
    return this.opts.isWaveOn?.('W05') ?? true;
  }

  /** Row visibility from the live wave flags; the whole panel hides when nothing is left in it. */
  private sync(): void {
    const grid = this.gridOn();
    const tf = this.terraformOn();
    this.daytimeEl.hidden = !grid;
    if (!grid) this.windEl.hidden = true;
    this.terraform.el.hidden = !tf;
    this.el.hidden = !grid && !tf;
  }

  update(view: GameView): void {
    this.sync();
    const idx = this.opts.getColonyIndex();
    const col = viewColony(view, idx);
    if (this.gridOn()) this.renderDaytime(view, idx);
    if (this.terraformOn()) this.renderTerraform(col, view, idx);
  }

  private renderDaytime(view: GameView, colonyIdx: number): void {
    const t = readDaytime(view, colonyIdx);
    this.daytimeEl.setAttribute('data-phase', t?.phase ?? 'day');
    this.daytimeIcon.textContent = t?.phase === 'night' ? '☾' : '☀';
    this.daytimeClock.textContent = t?.clockText ?? NO_DATA;
    this.daytimeLight.textContent = t ? `${Math.round(t.daylight * 100)}%` : '';
    const wind = readColonyPower(view, colonyIdx)?.windFactor;
    this.windEl.hidden = typeof wind !== 'number';
    if (typeof wind === 'number') this.windEl.textContent = formatWind(wind);
  }

  private renderTerraform(col: ViewColony | undefined, view: GameView | undefined, colonyIdx: number): void {
    const stats = readColonyTerraformStats(col, view, colonyIdx);
    const pctText = stats.percent.toFixed(1);
    const label = `Terraform ${stats.livingTiles} / ${stats.eligibleOwnedTiles} (${pctText} %)`;
    const tf = this.terraform;
    tf.val.textContent = label;
    tf.el.setAttribute('data-living', String(stats.livingTiles));
    tf.el.setAttribute('data-eligible', String(stats.eligibleOwnedTiles));
    tf.el.setAttribute('data-percent', pctText);
    tf.el.setAttribute('data-living-hint', '+10 % ground move speed');
    const gates = tierGateHint(col);
    tf.el.title = `${label} · ${TERRAFORM_BONUS_HINT} · ${gates}`;
    renderTerraformBreakdown(tf.breakdown, stats, gates);
  }

  dispose(): void {
    this.el.remove();
  }
}
