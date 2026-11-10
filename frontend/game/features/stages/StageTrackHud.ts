import { getStageSpec, STAGE_TABLE_ROWS, type StageRow, type ViewColony } from '@terra/sim';
import type { Disposable, FeatureContext } from '../../core/registry/types';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { stageGuideText } from './guide';
import {
  buildStageMetaSection,
  buildStagePanelHeader,
  buildStageSegments,
  extractDwellRemainingSeconds,
  formatDwellCountdown,
  updateStageSegmentStates,
} from './parts/stageTrackParts';
import { extractStageReachedData, StageToast, type StageToastOptions } from './StageToast';

export { extractDwellRemainingSeconds, formatDwellCountdown };

export class StageTrackHud implements Disposable {
  readonly root: HTMLElement;
  private readonly ctx: FeatureContext;
  private readonly segmentsContainer: HTMLElement;
  private readonly segmentEls: HTMLElement[];
  private readonly currentLabelEl: HTMLElement;
  private readonly currentTeachesEl: HTMLElement;
  private readonly nextConditionEl: HTMLElement;
  private readonly dwellCountdownEl: HTMLElement;
  private readonly toast: StageToast;
  private readonly cleanups: Array<() => void> = [];

  private readonly launcher = document.createElement('button');
  /** One-line stage summary beside the launcher; shown only inside the Colony book's Goals tab (stages.css). */
  private readonly summaryEl = document.createElement('p');
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

    buildStagePanelHeader({
      root: this.root,
      host,
      launcher: this.launcher,
      summaryEl: this.summaryEl,
      onToggle: () => this.setPanelVisible(this.panelHidden),
      onClose: () => {
        this.suppressNotices = true;
        this.setPanelVisible(false);
        this.launcher.focus();
      },
    });
    this.setPanelVisible(false);
    this.toast = new StageToast(this.root);

    this.segmentsContainer = document.createElement('div');
    this.segmentsContainer.className = 'ta-stage-track__segments';
    this.segmentsContainer.setAttribute('data-testid', 'stage-track-segments');
    this.segmentEls = buildStageSegments(this.segmentsContainer, (n) => this.browseStage(n));

    const metaDom = buildStageMetaSection();
    this.currentLabelEl = metaDom.currentLabelEl;
    this.currentTeachesEl = metaDom.currentTeachesEl;
    this.nextConditionEl = metaDom.nextConditionEl;
    this.dwellCountdownEl = metaDom.dwellCountdownEl;

    this.root.append(this.segmentsContainer, metaDom.meta);
    // The launcher stays in the panel (a Colony book tab); the dialog floats in the HUD overlay so it is neither
    // clipped by the book page nor hidden with an inactive tab (stage-reached notices must show from any tab).
    (ctx.services.hudOverlay ?? host).appendChild(this.root);

    this.renderStage(0, null, undefined);
    this.bindTransport(ctx);

    if (ctx.services.store?.latest) {
      this.update(ctx.services.store.latest);
    }
  }

  private bindTransport(ctx: FeatureContext): void {
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
  }

  /** Hides the goals dialog (and its toast) without muting later stage notices; used by `closeHudMenus`. */
  closePanel(): void {
    if (!this.panelHidden) this.setPanelVisible(false);
  }

  private setPanelVisible(visible: boolean): void {
    this.panelHidden = !visible;
    if (visible) this.suppressNotices = false;
    this.root.hidden = !visible;
    this.launcher.setAttribute('aria-expanded', String(visible));
    if (!visible) this.toast?.dismiss();
  }

  private browseStage(stage: number): void {
    const selected = Math.max(0, Math.min(STAGE_TABLE_ROWS.length - 1, stage));
    this.setPanelVisible(true);
    this.showStageToast(selected, { autoDismissMs: 0, replay: true });
  }

  private renderStage(stage: number, dwellS: number | null, nextConditionOverride?: string): void {
    this.currentStage = stage;
    this.launcher.textContent = `Goals · S${stage}`;
    const currentSpec: StageRow = getStageSpec(stage) ?? STAGE_TABLE_ROWS[0];

    updateStageSegmentStates(this.segmentEls, stage);

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
    this.summaryEl.textContent = resolvedNextCondition
      ? `${currentSpec.label}. Next: ${resolvedNextCondition}`
      : currentSpec.label;

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
      } catch {
        // Ignore transport unsubscribe error on teardown
      }
    }
    this.cleanups.length = 0;
    this.toast.dispose();
    this.root.remove();
    this.launcher.remove();
    this.summaryEl.remove();
  }
}
