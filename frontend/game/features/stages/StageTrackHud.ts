import { getStageSpec, STAGE_TABLE_ROWS, type StageRow, type ViewColony } from '@terra/sim';
import type { Disposable, FeatureContext } from '../../core/registry/types';
import { stageGuideText } from './guide';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { extractStageReachedData, StageToast, type StageToastOptions } from './StageToast';

/**
 * Formats a dwell countdown in seconds into M:SS representation (e.g. 80 -> "1:20", 5 -> "0:05").
 */
export function formatDwellCountdown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Extracts remaining dwell seconds from a colony view, supporting
 * `stageDwellRemainingS`, `dwellRemainingS`, or `dwellRemainingTicks` (5 ticks/s).
 */
export function extractDwellRemainingSeconds(col: ViewColony | undefined): number | null {
  if (!col) return null;
  if (typeof col.stageDwellRemainingS === 'number') {
    return col.stageDwellRemainingS;
  }
  if (typeof col.dwellRemainingS === 'number') {
    return col.dwellRemainingS;
  }
  if (typeof col.dwellRemainingTicks === 'number') {
    return Math.max(0, Math.ceil(col.dwellRemainingTicks / 5));
  }
  return null;
}

export class StageTrackHud implements Disposable {
  readonly root: HTMLElement;
  private readonly ctx: FeatureContext;
  private readonly segmentsContainer: HTMLElement;
  private readonly segmentEls: HTMLElement[] = [];
  private readonly currentLabelEl: HTMLElement;
  private readonly currentTeachesEl: HTMLElement;
  private readonly nextConditionEl: HTMLElement;
  private readonly dwellCountdownEl: HTMLElement;
  private readonly toast: StageToast;
  private readonly cleanups: Array<() => void> = [];

  private readonly launcher = document.createElement('button');
  private panelHidden = true;
  private suppressNotices = false;
  private currentStage = 0;
  private colonyIndex = 0;
  private hasBaseline = false;
  private previousStage = 0;

  constructor(host: HTMLElement, ctx: FeatureContext) {
    this.ctx = ctx;
    this.colonyIndex = ownColonyIndex(ctx.services);

    this.root = document.createElement('section');
    this.root.className = 'ta-stage-track-hud plate-sm';
    this.root.setAttribute('data-testid', 'stage-track-hud');

    this.buildPanelHeader(host);
    this.toast = new StageToast(this.root);

    // Segments container: 11 stage segments S0..S10
    this.segmentsContainer = document.createElement('div');
    this.segmentsContainer.className = 'ta-stage-track__segments';
    this.segmentsContainer.setAttribute('data-testid', 'stage-track-segments');
    this.buildSegments();

    // Meta section: current stage title/teaches + next condition & dwell countdown
    const meta = document.createElement('div');
    meta.className = 'ta-stage-track__meta';

    const currentBlock = document.createElement('div');
    currentBlock.className = 'ta-stage-track__current';

    this.currentLabelEl = document.createElement('div');
    this.currentLabelEl.className = 'ta-stage-track__label';
    this.currentLabelEl.setAttribute('data-testid', 'stage-current-label');

    this.currentTeachesEl = document.createElement('div');
    this.currentTeachesEl.className = 'ta-stage-track__teaches';
    this.currentTeachesEl.setAttribute('data-testid', 'stage-current-teaches');

    currentBlock.append(this.currentLabelEl, this.currentTeachesEl);

    const nextBlock = document.createElement('div');
    nextBlock.className = 'ta-stage-track__next';

    this.nextConditionEl = document.createElement('div');
    this.nextConditionEl.className = 'ta-stage-track__next-condition';
    this.nextConditionEl.setAttribute('data-testid', 'stage-next-condition');

    this.dwellCountdownEl = document.createElement('span');
    this.dwellCountdownEl.className = 'ta-stage-track__dwell';
    this.dwellCountdownEl.setAttribute('data-testid', 'stage-dwell-countdown');
    this.dwellCountdownEl.setAttribute('data-active', 'false');
    this.dwellCountdownEl.textContent = '—';

    nextBlock.append(this.nextConditionEl, this.dwellCountdownEl);

    meta.append(currentBlock, nextBlock);
    this.root.append(this.segmentsContainer, meta);
    host.appendChild(this.root);

    // Initial render at S0
    this.renderStage(0, null, undefined);

    const services = ctx.services as unknown as Record<string, unknown>;
    const rawCtx = ctx as unknown as Record<string, unknown>;
    const transport = (services.transport ?? rawCtx.transport) as {
      onMessage?: (fn: (m: unknown) => void) => unknown;
    } | undefined;

    if (transport && typeof transport.onMessage === 'function') {
      const off = transport.onMessage((m: unknown) => {
        this.handleTransportMessage(m);
      });
      if (typeof off === 'function') {
        this.cleanups.push(off as () => void);
      } else if (off && typeof off === 'object' && 'dispose' in off && typeof (off as { dispose: unknown }).dispose === 'function') {
        this.cleanups.push(() => (off as { dispose: () => void }).dispose());
      }
    }

    if (ctx.services.store?.latest) {
      this.update(ctx.services.store.latest);
    }
  }

  private buildPanelHeader(host: HTMLElement): void {
    this.root.id = 'stage-goals-dialog';
    this.root.setAttribute('aria-label', 'Stage goals');
    this.launcher.type = 'button';
    this.launcher.className = 'ta-stage-launcher btn btn-ghost btn-sm';
    this.launcher.dataset.testid = 'stage-goals-launcher';
    this.launcher.setAttribute('aria-controls', this.root.id);
    this.launcher.onclick = () => this.setPanelVisible(this.panelHidden);
    const header = document.createElement('div');
    header.className = 'ta-stage-panel-header';
    const title = document.createElement('span');
    title.textContent = 'Goals';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-ghost btn-sm';
    close.textContent = '−';
    close.dataset.testid = 'stage-goals-close';
    close.setAttribute('aria-label', 'Close stage goals');
    close.onclick = () => {
      this.suppressNotices = true;
      this.setPanelVisible(false);
      this.launcher.focus();
    };
    header.append(title, close);
    this.root.append(header);
    host.append(this.launcher);
    this.setPanelVisible(false);
  }

  private setPanelVisible(visible: boolean): void {
    this.panelHidden = !visible;
    if (visible) this.suppressNotices = false;
    this.root.hidden = !visible;
    this.launcher.setAttribute('aria-expanded', String(visible));
    if (!visible) this.toast?.dismiss();
  }

  private buildSegments(): void {
    for (const row of STAGE_TABLE_ROWS) {
      const n = row.stage;
      const el = document.createElement('button');
      el.type = 'button';
      el.onclick = () => this.browseStage(n);
      el.className = 'ta-stage-segment';
      el.setAttribute('data-testid', `stage-segment-S${n}`);
      el.setAttribute('data-stage', String(n));
      el.title = `${row.label}: ${row.teaches}`;

      const text = document.createElement('span');
      text.className = 'ta-stage-segment__name';
      text.textContent = row.id;
      el.appendChild(text);

      this.segmentEls.push(el);
      this.segmentsContainer.appendChild(el);
    }
  }

  private browseStage(stage: number): void {
    const selected = Math.max(0, Math.min(STAGE_TABLE_ROWS.length - 1, stage));
    this.setPanelVisible(true);
    this.showStageToast(selected, { autoDismissMs: 0, replay: true });
  }

  private updateSegmentStates(stage: number): void {
    for (let n = 0; n < this.segmentEls.length; n++) {
      const el = this.segmentEls[n];
      el.classList.remove('is-completed', 'is-current', 'is-next', 'is-locked');
      if (n < stage) {
        el.classList.add('is-completed');
        el.setAttribute('data-state', 'completed');
      } else if (n === stage) {
        el.classList.add('is-current');
        el.setAttribute('data-state', 'current');
      } else if (n === stage + 1) {
        el.classList.add('is-next');
        el.setAttribute('data-state', 'pending');
      } else {
        el.classList.add('is-locked');
        el.setAttribute('data-state', 'locked');
      }
    }
  }

  private renderStage(stage: number, dwellS: number | null, nextConditionOverride?: string): void {
    this.currentStage = stage;
    this.launcher.textContent = `Goals · S${stage}`;
    const currentSpec: StageRow = getStageSpec(stage) ?? STAGE_TABLE_ROWS[0];

    this.updateSegmentStates(stage);

    this.currentLabelEl.textContent = currentSpec.label;
    this.currentTeachesEl.textContent = currentSpec.teaches;

    const nextSpec = getStageSpec(stage + 1);
    const defaultNextCondition = nextSpec
      ? (nextSpec.unlockConditionText || nextSpec.triggerText || '')
      : '';
    const resolvedNextCondition =
      (typeof nextConditionOverride === 'string' && nextConditionOverride.trim() !== '')
        ? nextConditionOverride
        : defaultNextCondition;

    this.nextConditionEl.textContent = resolvedNextCondition || '—';

    if (dwellS !== null && dwellS > 0) {
      this.dwellCountdownEl.textContent = formatDwellCountdown(dwellS);
      this.dwellCountdownEl.dataset.active = 'true';
      this.dwellCountdownEl.hidden = false;
    } else {
      this.dwellCountdownEl.textContent = '—';
      this.dwellCountdownEl.dataset.active = 'false';
    }
  }

  update(view?: unknown): void {
    if (!view) return;
    this.colonyIndex = ownColonyIndex(this.ctx.services);

    const col = viewColony(view, this.colonyIndex) ??
      ((view && typeof view === 'object' && ('stage' in view || 'colonies' in view))
        ? (view as ViewColony)
        : undefined);

    const stage = typeof col?.stage === 'number' ? col.stage : 0;
    const dwell = extractDwellRemainingSeconds(col);
    const condition = typeof col?.nextStageConditionText === 'string'
      ? col.nextStageConditionText
      : undefined;

    this.renderStage(stage, dwell, condition);

    if (!this.hasBaseline) {
      this.hasBaseline = true;
      this.previousStage = stage;
    } else if (stage > this.previousStage) {
      const colRecord = col as Record<string, unknown> | undefined;
      const override = typeof colRecord?.stageOverride === 'string'
        ? colRecord.stageOverride
        : typeof colRecord?.override === 'string'
          ? colRecord.override
          : undefined;
      this.previousStage = stage;
      this.showStageToast(stage, { override });
    }
  }

  showStageToast(stage: number, opts?: StageToastOptions): HTMLElement {
    if (!opts?.replay) this.previousStage = Math.max(this.previousStage, stage);

    if (!this.suppressNotices || opts?.replay) this.setPanelVisible(true);
    const el = this.toast.show(stage, {
      guide: stageGuideText(stage, opts?.replay ? this.currentStage : Math.max(stage, this.currentStage)),
      ...opts,
    });
    if (this.suppressNotices && !opts?.replay) this.toast.dismiss();
    return el;
  }

  dismissStageToast(): void {
    this.toast.dismiss();
  }

  getActiveToast(): HTMLElement | null {
    return this.toast.getElement();
  }

  private handleTransportMessage(m: unknown): void {
    const data = extractStageReachedData(m);
    if (!data) return;
    if (typeof data.colonyIndex === 'number' && data.colonyIndex !== this.colonyIndex) {
      return;
    }
    if (data.stage === this.previousStage && this.toast.getElement()) return;
    this.showStageToast(data.stage, {
      title: data.title,
      teaches: data.teaches,
      units: data.units,
      buildings: data.buildings,
      orders: data.orders,
      override: data.override,
    });
  }

  getCurrentStage(): number {
    return this.currentStage;
  }

  dispose(): void {
    for (const c of this.cleanups) {
      try {
        c();
      } catch {}
    }
    this.cleanups.length = 0;
    this.toast.dispose();
    this.root.remove();
    this.launcher.remove();
  }
}
