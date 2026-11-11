import type { FeatureContext, HudPanelInstance } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import { createColonyStatusDom } from './parts/statusDom';
import {
  applyColonyStatusSimEvent,
  extractColonyStatusView,
  formatCriticalCountdown,
  type ColonyStatusHudOptions,
  type ColonyStatusView,
} from './types';
declare module '../../core/registry/types' {
  interface FeatureServices {
    startHubPlacement?: () => void;
    selectBuildItem?: (item: string) => void;
  }
}

export interface ColonyStatusHudInstance extends HudPanelInstance {
  readonly el: HTMLElement;
  readonly bannerEl: HTMLElement;
  readonly eliminatedEl: HTMLElement;
  getView(): ColonyStatusView;
  update(view?: unknown): void;
  ingestSimEvents(events?: readonly unknown[] | unknown): void;
  dispose(): void;
}

export class ColonyStatusHud implements ColonyStatusHudInstance {
  readonly el: HTMLElement;
  readonly bannerEl: HTMLElement;
  readonly eliminatedEl: HTMLElement;

  private readonly titleEl: HTMLElement;
  private readonly placeHubBtn: HTMLButtonElement;
  private readonly eliminatedTitleEl: HTMLElement;
  private readonly eliminatedDetailEl: HTMLElement;
  private readonly foundNewColonyBtn: HTMLButtonElement;

  private currentView: ColonyStatusView;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(
    parentEl: HTMLElement,
    private readonly ctx: FeatureContext,
    private readonly options: ColonyStatusHudOptions = {},
  ) {
    this.currentView = {
      colonyIndex: options.ownColonyIndex ?? 0,
      status: 'active',
      hqDown: false,
      criticalDeadlineTick: null,
      criticalRemainingSeconds: 0,
      eliminatedAtTick: null,
      eliminatedReason: null,
      eliminatedByColonyId: null,
      currentTick: 0,
    };

    this.el = parentEl;
    this.el.classList.add('ta-colony-status-hud');
    const hostEl = this.ctx.services?.hudOverlay ?? parentEl;
    if (this.ctx.services?.hudOverlay && this.ctx.services.hudOverlay !== parentEl) {
      this.el.hidden = true;
    }

    const dom = createColonyStatusDom(
      hostEl,
      () => this.handlePlaceHub(),
      () => this.handleFoundNewColony(),
    );
    this.bannerEl = dom.bannerEl;
    this.titleEl = dom.titleEl;
    this.placeHubBtn = dom.placeHubBtn;
    this.eliminatedEl = dom.eliminatedEl;
    this.eliminatedTitleEl = dom.eliminatedTitleEl;
    this.eliminatedDetailEl = dom.eliminatedDetailEl;
    this.foundNewColonyBtn = dom.foundNewColonyBtn;

    this.render();
  }

  getView(): ColonyStatusView {
    return { ...this.currentView };
  }

  update(rawView?: unknown): void {
    if (rawView === undefined || rawView === null) return;
    const ownIdx = ownColonyIndex(this.ctx.services, this.options.ownColonyIndex);
    const nextView = extractColonyStatusView(rawView, ownIdx);
    this.applyView(nextView);
  }

  ingestSimEvents(events?: readonly unknown[] | unknown): void {
    if (!events) return;
    const list = Array.isArray(events) ? events : [events];
    const ownIdx = ownColonyIndex(this.ctx.services, this.options.ownColonyIndex);
    let next = { ...this.currentView, colonyIndex: ownIdx };
    for (const ev of list) {
      if (!ev) continue;
      next = applyColonyStatusSimEvent(next, ev);
    }
    this.applyView(next);
  }

  private applyView(nextView: ColonyStatusView): void {
    this.currentView = nextView;
    this.render();
  }

  private render(): void {
    const { status, criticalRemainingSeconds } = this.currentView;

    if (status === 'critical') {
      this.bannerEl.hidden = false;
      this.bannerEl.removeAttribute('hidden');
      this.eliminatedEl.hidden = true;
      this.eliminatedEl.setAttribute('hidden', '');
      this.titleEl.textContent = `HUB LOST — REBUILD WITHIN ${formatCriticalCountdown(criticalRemainingSeconds)}`;
      this.startCountdownTimer();
    } else if (status === 'eliminated') {
      this.stopCountdownTimer();
      this.bannerEl.hidden = true;
      this.bannerEl.setAttribute('hidden', '');
      this.eliminatedEl.hidden = false;
      this.eliminatedEl.removeAttribute('hidden');
      this.eliminatedTitleEl.textContent = 'COLONY ELIMINATED';
      this.renderEliminatedDetail();
    } else {
      this.stopCountdownTimer();
      this.bannerEl.hidden = true;
      this.bannerEl.setAttribute('hidden', '');
      this.eliminatedEl.hidden = true;
      this.eliminatedEl.setAttribute('hidden', '');
    }
  }

  private renderEliminatedDetail(): void {
    const killer = this.currentView.eliminatedByColonyId;
    const reason = this.currentView.eliminatedReason;
    if (killer) {
      this.eliminatedDetailEl.textContent = `Eliminated by Colony ${killer}. Command Hub and defensive perimeter lost.`;
    } else if (reason) {
      this.eliminatedDetailEl.textContent = `Colony eliminated: ${reason}. Command Hub not restored in time.`;
    } else {
      this.eliminatedDetailEl.textContent = 'Command Hub destroyed — rebuild deadline expired.';
    }
  }

  private startCountdownTimer(): void {
    if (this.timerId !== null) return;
    this.timerId = setInterval(() => {
      if (this.currentView.status !== 'critical') {
        this.stopCountdownTimer();
        return;
      }
      if (this.currentView.criticalRemainingSeconds > 0) {
        this.currentView.criticalRemainingSeconds = Math.max(0, this.currentView.criticalRemainingSeconds - 1);
        this.titleEl.textContent = `HUB LOST — REBUILD WITHIN ${formatCriticalCountdown(this.currentView.criticalRemainingSeconds)}`;
      } else {
        this.titleEl.textContent = 'HUB LOST — REBUILD WITHIN 00:00';
      }
    }, 1000);
  }

  private stopCountdownTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private handlePlaceHub(): void {
    this.options.onPlaceHub?.();
    const services = this.ctx.services;
    if (typeof services.startHubPlacement === 'function') {
      services.startHubPlacement();
    } else if (typeof services.hubPlacement?.startPlacement === 'function') {
      services.hubPlacement.startPlacement();
    } else if (typeof services.selectBuildItem === 'function') {
      services.selectBuildItem('commandHub');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ta:place-hub', { detail: { buildingId: 'commandHub' } }));
    }
  }

  private handleFoundNewColony(): void {
    this.options.onFoundNewColony?.();
    if (typeof this.options.navigate === 'function') {
      this.options.navigate('/play.html');
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ta:found-new-colony'));
      const isTestEnv = typeof process !== 'undefined' && Boolean(process.env?.VITEST);
      if (!isTestEnv && !this.options.navigate && typeof window.location?.assign === 'function') {
        try {
          window.location.assign('/play.html');
        } catch {
          // ignore navigation errors in test / embedded contexts
        }
      }
    }
  }

  dispose(): void {
    this.stopCountdownTimer();
    this.bannerEl.remove();
    this.eliminatedEl.remove();
  }
}

export function createColonyStatusHud(
  el: HTMLElement,
  ctx: FeatureContext,
  options?: ColonyStatusHudOptions,
): ColonyStatusHudInstance {
  return new ColonyStatusHud(el, ctx, options);
}
