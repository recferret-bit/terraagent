import type { SimEventWire } from '@terra/contracts';
import { tileXZ } from '@terra/render/planets/hex';
import { DEPOSIT, ENTITY_KIND, ENTITY_STATE, hexDistance, hexIndex, PREP, TERRAIN, TICK_MS } from '@terra/sim';
import * as THREE from 'three';
import { setGameInputBlocked } from '../../core/input/gameInputBlock';
import type { FeatureContext } from '../../core/registry/types';
import { forEachEntity, type ClientTiles, type ClientView } from '../../store/replica/viewCodec';
import { ownColonyIndex } from '../shared/colony';

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

const MODAL_STYLE_ID = 'ta-hq-respawn-modal-styles';
const MODAL_CSS = `
  .ta-hq-respawn-backdrop {
    position: fixed; inset: 0; z-index: 9500; display: none; align-items: center; justify-content: center;
    padding: var(--ta-s5); background: color-mix(in srgb, var(--ta-void) 84%, transparent);
    backdrop-filter: blur(6px); pointer-events: auto; user-select: none;
  }
  .ta-hq-respawn-backdrop[data-open="true"] { display: flex; }
  .ta-hq-respawn-card {
    position: relative; width: min(560px, 94vw); background: var(--ta-plate);
    border: 1.5px solid var(--ta-fault); box-shadow: var(--ta-glow-3); color: var(--ta-text); overflow: hidden;
  }
  .ta-hq-respawn-hazard { height: 10px; width: 100%; }
  .ta-hq-respawn-inner { position: relative; display: flex; flex-direction: column; gap: var(--ta-s4); padding: var(--ta-s6); }
  .ta-hq-respawn-title {
    margin: 0; font-family: var(--ta-font-display); font-size: var(--ta-fs-h2);
    font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ta-text);
  }
  .ta-hq-respawn-desc { margin: 0; font-family: var(--ta-font-body); font-size: var(--ta-fs-small); color: var(--ta-text-2); line-height: 1.5; }
  .ta-hq-respawn-telemetry {
    display: flex; align-items: center; justify-content: space-between; gap: var(--ta-s3);
    padding: var(--ta-s3) var(--ta-s4); background: var(--ta-deep); border: 1px solid var(--ta-seam-2);
    font-family: var(--ta-font-mono); font-size: var(--ta-fs-eyebrow); letter-spacing: var(--ta-track-label); color: var(--ta-energy);
  }
  .ta-hq-respawn-countdown-box {
    display: flex; flex-direction: column; align-items: center; gap: var(--ta-s3);
    padding: var(--ta-s5); background: var(--ta-deep); border: 1px solid var(--ta-seam-3);
  }
  .ta-hq-respawn-timer {
    font-family: var(--ta-font-mono); font-size: 48px; font-weight: 600; line-height: 1;
    letter-spacing: 0.08em; font-variant-numeric: tabular-nums; color: var(--ta-orange-hi);
  }
  .ta-hq-respawn-bar { width: 100%; height: 14px; background: var(--ta-plate-3); border: 1px solid var(--ta-seam-3); overflow: hidden; }
  .ta-hq-respawn-bar-fill { height: 100%; width: 0%; background: var(--ta-orange); transition: width var(--ta-dur-instant) linear; }
  .ta-hq-respawn-footer {
    font-family: var(--ta-font-mono); font-size: var(--ta-fs-label); letter-spacing: var(--ta-track-label);
    text-align: center; color: var(--ta-fault-text); text-transform: uppercase;
  }
`;

function ensureModalStyles(): void {
  if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function') return;
  if (typeof document.getElementById === 'function' && document.getElementById(MODAL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MODAL_STYLE_ID;
  style.textContent = MODAL_CSS;
  document.head.appendChild(style);
}

/** Finds the closest terraformed ground tile `(q, r)` on the client view to `(refQ, refR)`. */
export function findClientClosestTerraformedTile(
  view: ClientView,
  tiles: ClientTiles | null | undefined,
  colonyId: number,
  refQ: number,
  refR: number,
): { q: number; r: number } {
  if (!tiles || !tiles.terrain || !tiles.prep) return { q: refQ, r: refR };
  const hx = hexIndex(view.planet.radius);
  const occupied = new Set<number>();
  forEachEntity(view.entities, view.count, (e) => {
    if (e.hp <= 0) return;
    if ((e.kind === ENTITY_KIND.hq || e.kind === ENTITY_KIND.pod) && e.owner === colonyId) return;
    const idx = hx.indexOf(e.q, e.r);
    if (idx >= 0) occupied.add(idx);
  });

  let bestTf: { q: number; r: number; score: number } | null = null;
  let bestFallback: { q: number; r: number; score: number } | null = null;

  for (let idx = 0; idx < tiles.count; idx++) {
    if (occupied.has(idx)) continue;
    const terrain = tiles.terrain[idx];
    const prep = tiles.prep[idx];
    const deposit = tiles.deposit?.[idx] ?? DEPOSIT.none;
    if (
      terrain === TERRAIN.deep ||
      terrain === TERRAIN.shallow ||
      terrain === TERRAIN.hole ||
      terrain === TERRAIN.rock ||
      prep === PREP.ridge ||
      prep === PREP.moat ||
      deposit !== DEPOSIT.none
    ) {
      continue;
    }
    const q = hx.q[idx]!;
    const r = hx.r[idx]!;
    const dist = hexDistance(refQ, refR, q, r);
    const ownerBonus = (tiles.owner?.[idx] ?? -1) === colonyId ? 0.15 : 0;
    const isTf =
      terrain === TERRAIN.flat &&
      (prep === PREP.flat || prep === PREP.prepared || prep === PREP.irrigated || prep === PREP.living);
    if (isTf) {
      const prepBonus = prep >= PREP.prepared && prep <= PREP.living ? 0.05 : 0;
      const score = dist - ownerBonus - prepBonus;
      if (!bestTf || score < bestTf.score) bestTf = { q, r, score };
    } else {
      const score = dist + (terrain === TERRAIN.flat ? 0 : 0.35) - ownerBonus;
      if (!bestFallback || score < bestFallback.score) bestFallback = { q, r, score };
    }
  }
  return bestTf ?? bestFallback ?? { q: refQ, r: refR };
}

function readHqRespawnRecord(view: ClientView, colonyIndex: number): HqRespawnBlobRecord | undefined {
  const raw = view.blobs?.hqRespawn as Record<string, HqRespawnBlobRecord> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw[colonyIndex] ?? raw[String(colonyIndex)];
  return rec && typeof rec === 'object' && typeof rec.q === 'number' ? rec : undefined;
}

function readHqColonyTracker(view: ClientView, colonyIndex: number): { deployed: boolean; lastQ: number; lastR: number } | undefined {
  const raw = view.blobs?.hqColonyTracker as Record<string, { deployed?: boolean; lastQ?: number; lastR?: number }> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw[colonyIndex] ?? raw[String(colonyIndex)];
  if (!rec || typeof rec !== 'object' || !rec.deployed) return undefined;
  return { deployed: true, lastQ: typeof rec.lastQ === 'number' ? rec.lastQ : 0, lastR: typeof rec.lastR === 'number' ? rec.lastR : 0 };
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
    this.el = this.buildDom(parentEl);
  }

  private buildDom(parentEl: HTMLElement): HTMLElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'ta-hq-respawn-backdrop';
    backdrop.setAttribute('data-testid', 'hq-respawn-modal');
    backdrop.setAttribute('data-open', 'false');
    backdrop.setAttribute('role', 'alertdialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.hidden = true;
    backdrop.style.pointerEvents = 'auto';

    const card = document.createElement('div');
    card.className = 'ta-hq-respawn-card plate-lg brackets';
    const hazard = document.createElement('div');
    hazard.className = 'ta-hq-respawn-hazard hazard';
    const scan = document.createElement('div');
    scan.className = 'scanlines';
    const inner = document.createElement('div');
    inner.className = 'ta-hq-respawn-inner';

    const badge = document.createElement('div');
    badge.className = 'badge badge-alert';
    badge.setAttribute('data-testid', 'hq-respawn-badge');
    badge.textContent = 'CRITICAL TELEMETRY ALERT // COMMAND UNIT LOST';

    const title = document.createElement('h2');
    title.className = 'ta-hq-respawn-title';
    title.setAttribute('data-testid', 'hq-respawn-title');
    title.textContent = 'HQ EXPLORER DESTROYED';

    const desc = document.createElement('p');
    desc.className = 'ta-hq-respawn-desc';
    desc.textContent =
      'Colony HQ Explorer Drone was destroyed by planetary hazard activity. Orbital Carrier is preparing an emergency replacement Explorer Pod for immediate atmospheric drop.';

    const telemetry = document.createElement('div');
    telemetry.className = 'ta-hq-respawn-telemetry plate-sm';
    telemetry.setAttribute('data-testid', 'hq-respawn-target');
    telemetry.textContent = 'CLOSEST TERRAFORMED GROUND · HEX (0, 0)';
    this.targetEl = telemetry;

    const countdownBox = document.createElement('div');
    countdownBox.className = 'ta-hq-respawn-countdown-box plate-sm';
    const countdownLabel = document.createElement('div');
    countdownLabel.className = 'eyebrow';
    countdownLabel.textContent = 'EMERGENCY REPLACEMENT POD LAUNCH COUNTDOWN';
    const timer = document.createElement('div');
    timer.className = 'ta-hq-respawn-timer';
    timer.setAttribute('data-testid', 'hq-respawn-timer');
    timer.textContent = '30.0s';
    this.timerEl = timer;
    const bar = document.createElement('div');
    bar.className = 'ta-hq-respawn-bar plate-sm';
    const fill = document.createElement('div');
    fill.className = 'ta-hq-respawn-bar-fill';
    fill.setAttribute('data-testid', 'hq-respawn-progress');
    fill.style.width = '0%';
    this.progressEl = fill;
    bar.appendChild(fill);
    countdownBox.appendChild(countdownLabel);
    countdownBox.appendChild(timer);
    countdownBox.appendChild(bar);

    const footer = document.createElement('div');
    footer.className = 'ta-hq-respawn-footer';
    footer.setAttribute('data-testid', 'hq-respawn-footer');
    footer.textContent = 'ORBITAL POD LAUNCH LOCKED — COUNTDOWN CANNOT BE SKIPPED';

    for (const child of [badge, title, desc, telemetry, countdownBox, footer]) inner.appendChild(child);
    for (const child of [hazard, scan, inner]) card.appendChild(child);
    backdrop.appendChild(card);
    parentEl.appendChild(backdrop);
    return backdrop;
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
    if (this.targetEl) {
      this.targetEl.textContent = `CLOSEST TERRAFORMED GROUND · HEX (${this.targetTile.q}, ${this.targetTile.r})`;
      this.targetEl.setAttribute('data-target-q', String(this.targetTile.q));
      this.targetEl.setAttribute('data-target-r', String(this.targetTile.r));
    }
    const clamped = Math.max(0, Math.min(this.totalS, this.remainingS));
    const wholeSec = Math.ceil(clamped);
    const mm = String(Math.floor(wholeSec / 60)).padStart(2, '0');
    const ss = String(wholeSec % 60).padStart(2, '0');
    if (this.timerEl) {
      this.timerEl.textContent = `${clamped.toFixed(1)}s (${mm}:${ss})`;
      this.timerEl.setAttribute('data-remaining-s', clamped.toFixed(1));
    }
    if (this.progressEl) {
      const pct = Math.max(0, Math.min(100, ((this.totalS - clamped) / Math.max(1, this.totalS)) * 100));
      this.progressEl.style.width = `${pct.toFixed(1)}%`;
    }
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
    let aliveHq = false, podDescending = false, descendingPodId: number | null = null;
    let podQ = this.targetTile.q, podR = this.targetTile.r;

    forEachEntity(simView.entities, simView.count, (e) => {
      if (e.owner !== colonyIndex) return;
      if (e.kind === ENTITY_KIND.hq && e.hp > 0) {
        aliveHq = true;
        this.hadAliveHq = true;
        this.lastHqPos = { q: e.q, r: e.r };
      } else if (e.kind === ENTITY_KIND.pod && e.state === ENTITY_STATE.descending) {
        podDescending = true;
        descendingPodId = e.id;
        podQ = e.q;
        podR = e.r;
      }
    });

    const trackerRec = readHqColonyTracker(simView, colonyIndex);
    if (trackerRec) {
      this.hadAliveHq = true;
      if (!aliveHq) this.lastHqPos = { q: trackerRec.lastQ, r: trackerRec.lastR };
    }
    const respawnRec = readHqRespawnRecord(simView, colonyIndex);
    if (respawnRec) this.hadAliveHq = true;

    if (!this.active) {
      if (this.pendingOpen) {
        if (respawnRec) { this.pendingOpen.q = respawnRec.q; this.pendingOpen.r = respawnRec.r; }
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

  public dispose(): void {
    this.close();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onCaptureKeyDown, true);
    }
    this.el?.remove();
  }
}
