import type { SimEventWire } from '@terra/contracts';
import { tileXZ } from '@terra/render/planets/hex';
import { TICK_MS } from '@terra/sim';
import * as THREE from 'three';
import { setGameInputBlocked } from '../../core/input/gameInputBlock';
import type { FeatureContext } from '../../core/registry/types';
import '../../core/ui/scrim.css';
import type { ClientView } from '../../store/replica/viewCodec';
import { ownColonyIndex } from '../shared/colony';
import {
  buildHqRespawnModalDom,
  ensureModalStyles,
  findClientClosestTerraformedTile,
  readHqColonyTracker,
  readHqRespawnRecord,
  renderHqRespawnTelemetry,
  scanColonyHqAndPodState,
} from './parts/hqRespawnParts';

export { findClientClosestTerraformedTile };

export const HQ_RESPAWN_INPUT_SOURCE = 'hq-respawn';
export const HQ_RESPAWN_DURATION_S = 30;

export interface HqRespawnBlobRecord {
  colonyId: number;
  deadAtTick: number;
  respawnAtTick: number;
  ticksRemaining: number;
  totalTicks: number;
  q: number;
  r: number;
  lastHqQ: number;
  lastHqR: number;
}

/**
 * Unskippable 30-second countdown modal displayed when the colony's HQ Explorer Drone is destroyed.
 * Blocks all game input and Escape/Space/Enter dismissal, keeps the simulation running, and focuses the camera
 * onto the closest terraformed landing site when the replacement Explorer Pod launches from orbit.
 */
export class HqRespawnModal {
  public readonly el: HTMLElement | null = null;
  private targetEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private active = false;
  private hadAliveHq = false;
  private remainingS = HQ_RESPAWN_DURATION_S;
  private totalS = HQ_RESPAWN_DURATION_S;
  private elapsedOpenS = 0;
  private targetTile = { q: 0, r: 0 };
  private lastHqPos = { q: 0, r: 0 };
  private lastFocusedRespawnPodId: number | null = null;
  private pendingOpen: { q: number; r: number; countdownS?: number } | null = null;
  private pendingImpactDelayS = 0;
  private getImpactDelayS?: () => number;
  private readonly onCaptureKeyDown: (e: KeyboardEvent) => void;

  constructor(
    private readonly ctx: FeatureContext,
    parentEl: HTMLElement | null,
    getImpactDelayS?: () => number,
  ) {
    this.getImpactDelayS = getImpactDelayS;
    this.onCaptureKeyDown = (e: KeyboardEvent) => {
      if (!this.active) return;
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      }
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onCaptureKeyDown, true);
    }
    if (typeof document === 'undefined' || !parentEl) return;
    ensureModalStyles();
    const dom = buildHqRespawnModalDom(parentEl);
    this.el = dom.backdrop;
    this.targetEl = dom.targetEl;
    this.timerEl = dom.timerEl;
    this.progressEl = dom.progressEl;
  }

  public isOpen(): boolean {
    return this.active;
  }

  public getRemainingS(): number {
    return this.remainingS;
  }

  public getTargetTile(): { q: number; r: number } {
    return { ...this.targetTile };
  }

  private ensureSimulationUnpaused(): void {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const pauseEl = document.querySelector<HTMLElement>('[data-testid="online-pause"]');
    if (pauseEl && pauseEl.getAttribute('data-active') === 'true') {
      const resumeBtn = document.querySelector<HTMLButtonElement>('[data-testid="pause-resume"]');
      resumeBtn?.click();
    }
  }

  public setImpactDelayProvider(fn: () => number): void {
    this.getImpactDelayS = fn;
  }

  public requestOpen(opts: { q: number; r: number; countdownS?: number }): void {
    const delay = Math.max(this.pendingImpactDelayS, this.getImpactDelayS?.() ?? 0);
    if (!this.active && delay > 0.01) {
      this.pendingOpen = { q: opts.q, r: opts.r, countdownS: opts.countdownS ?? HQ_RESPAWN_DURATION_S };
      this.pendingImpactDelayS = delay;
      return;
    }
    this.open(opts);
  }

  public open(opts: { q: number; r: number; countdownS?: number }): void {
    this.pendingOpen = null;
    this.pendingImpactDelayS = 0;
    this.targetTile = { q: opts.q, r: opts.r };
    const dur = typeof opts.countdownS === 'number' && opts.countdownS > 0 ? opts.countdownS : HQ_RESPAWN_DURATION_S;
    if (!this.active) {
      this.active = true;
      this.totalS = HQ_RESPAWN_DURATION_S;
      this.remainingS = dur;
      this.elapsedOpenS = 0;
      setGameInputBlocked(HQ_RESPAWN_INPUT_SOURCE, true);
      // The HQ is gone: fold both tab books and close every open dialog, ghost and brush (like the Esc menu's calm).
      this.ctx.services.closeHudMenus?.();
      if (this.el) {
        this.el.hidden = false;
        this.el.setAttribute('data-open', 'true');
        this.el.style.display = 'flex';
      }
    }
    this.ensureSimulationUnpaused();
    this.renderTelemetry();
  }

  public close(): void {
    this.pendingOpen = null;
    this.pendingImpactDelayS = 0;
    if (!this.active) return;
    this.active = false;
    setGameInputBlocked(HQ_RESPAWN_INPUT_SOURCE, false);
    if (this.el) {
      this.el.hidden = true;
      this.el.setAttribute('data-open', 'false');
      this.el.style.display = 'none';
    }
  }

  private renderTelemetry(): void {
    renderHqRespawnTelemetry(
      { targetEl: this.targetEl, timerEl: this.timerEl, progressEl: this.progressEl },
      this.targetTile,
      this.remainingS,
      this.totalS,
    );
  }

  private focusCameraOnTile(q: number, r: number): void {
    const svc = this.ctx.services as {
      focusTile?: (tq: number, tr: number, snap?: boolean) => void;
      rtsCamera?: { focus?(p: THREE.Vector3, instant?: boolean): void } | null;
    };
    if (typeof svc.focusTile === 'function') {
      svc.focusTile(q, r, false);
      return;
    }
    if (svc.rtsCamera && typeof svc.rtsCamera.focus === 'function') {
      const [wx, wz] = tileXZ(q, r);
      const wy = this.ctx.services.scene3d ? this.ctx.services.scene3d.tileToWorld(q, r).y : 0;
      svc.rtsCamera.focus(new THREE.Vector3(wx, wy, wz), false);
    }
  }

  public handleSimEvents(events: readonly SimEventWire[]): void {
    const colonyIndex = ownColonyIndex(this.ctx.services);
    for (const ev of events) {
      const d = (ev.data ?? {}) as Record<string, unknown>;
      if (ev.kind === 'hqDestroyed') {
        if (typeof d.colonyId === 'number' && d.colonyId !== colonyIndex) continue;
        const q = typeof d.q === 'number' ? d.q : this.lastHqPos.q;
        const r = typeof d.r === 'number' ? d.r : this.lastHqPos.r;
        const countdownS = typeof d.countdownS === 'number' ? d.countdownS : HQ_RESPAWN_DURATION_S;
        this.hadAliveHq = true;
        this.requestOpen({ q, r, countdownS });
      } else if (ev.kind === 'hqRespawnPodLaunched') {
        if (typeof d.colonyId === 'number' && d.colonyId !== colonyIndex) continue;
        const q = typeof d.q === 'number' ? d.q : this.targetTile.q;
        const r = typeof d.r === 'number' ? d.r : this.targetTile.r;
        this.targetTile = { q, r };
        this.close();
        this.focusCameraOnTile(q, r);
      }
    }
  }

  public syncAndStep(simView: ClientView | null, dt: number): void {
    const step = Math.max(0, dt);
    if (!simView) {
      if (this.pendingOpen && !this.active) {
        this.pendingImpactDelayS = Math.max(0, this.pendingImpactDelayS - step);
        if (this.pendingImpactDelayS <= 0.01 && (this.getImpactDelayS?.() ?? 0) <= 0.01) {
          this.open(this.pendingOpen);
        }
      } else if (this.active) {
        this.remainingS = Math.max(0, this.remainingS - step);
        this.elapsedOpenS += step;
        this.renderTelemetry();
      }
      return;
    }

    const colonyIndex = ownColonyIndex(this.ctx.services);
    const { aliveHq, hqPos, podDescending, descendingPodId, podQ, podR } = scanColonyHqAndPodState(
      simView,
      colonyIndex,
      this.targetTile,
    );
    if (hqPos) {
      this.hadAliveHq = true;
      this.lastHqPos = hqPos;
    }

    const trackerRec = readHqColonyTracker(simView, colonyIndex);
    if (trackerRec) {
      this.hadAliveHq = true;
      if (!aliveHq) this.lastHqPos = { q: trackerRec.lastQ, r: trackerRec.lastR };
    }
    const respawnRec = readHqRespawnRecord(simView, colonyIndex);
    if (respawnRec) this.hadAliveHq = true;

    if (!this.active) {
      this.stepInactive(simView, colonyIndex, aliveHq, podDescending, respawnRec, step);
      return;
    }

    this.ensureSimulationUnpaused();
    this.elapsedOpenS += step;
    this.remainingS = Math.max(0, this.remainingS - step);

    if (respawnRec) {
      this.targetTile = { q: respawnRec.q, r: respawnRec.r };
      const simRemS = (respawnRec.ticksRemaining * TICK_MS) / 1000;
      if (step === 0 || Math.abs(this.remainingS - simRemS) > 0.65) {
        this.remainingS = simRemS;
      }
    }

    this.renderTelemetry();

    if (podDescending) {
      this.targetTile = { q: podQ, r: podR };
      this.close();
      if (descendingPodId !== this.lastFocusedRespawnPodId) {
        this.lastFocusedRespawnPodId = descendingPodId;
        this.focusCameraOnTile(podQ, podR);
      }
    } else if ((aliveHq && !respawnRec && this.elapsedOpenS > 0.2) || (this.remainingS <= 0 && !respawnRec)) {
      this.close();
      this.focusCameraOnTile(this.targetTile.q, this.targetTile.r);
    }
  }

  private stepInactive(
    simView: ClientView,
    colonyIndex: number,
    aliveHq: boolean,
    podDescending: boolean,
    respawnRec: HqRespawnBlobRecord | undefined,
    step: number,
  ): void {
    if (this.pendingOpen) {
      if (respawnRec) {
        this.pendingOpen.q = respawnRec.q;
        this.pendingOpen.r = respawnRec.r;
      }
      this.pendingImpactDelayS = Math.max(0, this.pendingImpactDelayS - step);
      const liveDelay = this.getImpactDelayS ? this.getImpactDelayS() : this.pendingImpactDelayS;
      if (this.pendingImpactDelayS <= 0.01 || liveDelay <= 0.01) {
        this.open(this.pendingOpen);
      }
      return;
    }
    if (respawnRec && respawnRec.ticksRemaining > 0 && !aliveHq && !podDescending) {
      const remS = (respawnRec.ticksRemaining * TICK_MS) / 1000;
      this.requestOpen({ q: respawnRec.q, r: respawnRec.r, countdownS: remS });
    } else if (this.hadAliveHq && !aliveHq && !podDescending) {
      const tiles = simView.tiles ?? this.ctx.services.store?.latestTiles;
      const target = findClientClosestTerraformedTile(simView, tiles, colonyIndex, this.lastHqPos.q, this.lastHqPos.r);
      this.requestOpen({ q: target.q, r: target.r, countdownS: HQ_RESPAWN_DURATION_S });
    }
  }

  public dispose(): void {
    this.close();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onCaptureKeyDown, true);
    }
    this.el?.remove();
  }
}
