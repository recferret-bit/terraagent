import type { PlanetSummaryV1 } from '@terra/contracts';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { OrbitalGlobeMarkerInput, OrbitalProjectedFrame } from '@terra/render/orbit/types';
import type { ActiveHomeColony } from '../../../design/pilot/activeHomeColony';
import type { SectorIntentV1 } from '../lobby/orbitalPickerModel';
import { bindSectorChooserEvents, renderSectorChooserHtml } from '../lobby/sectorChooser';
import {
  renderLaunchCardShellHtml,
  renderPresenceCardInnerHtml,
  renderScanCardInnerHtml,
} from './arHudTemplates';
import { ArLeaderLines } from './arLeaderLines';
import { buildOrbitalGlobeMarkers, resolveHomeBaseSectorId, resolveTargetSectorId } from './sectorGlobeMap';

export interface OrbitalArHudCallbacks {
  onSectorSelect(intent: SectorIntentV1): void;
  onDeploy(): void;
  onMarkerHover?(sectorId: string | null): void;
}

export interface OrbitalArState {
  readonly kind: PlanetKind;
  readonly summary: PlanetSummaryV1;
  readonly intent: SectorIntentV1;
  readonly queuePaused: boolean;
  readonly activeColony: ActiveHomeColony | null;
}

type ArCardKey = 'scan' | 'presence' | 'launch';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** C1-smooth quintic wave that glides in 3D then hovers weightlessly at apex/trough (~0.9s dwell). */
function gyroDwellWave(u: number): number {
  const s = Math.sin(u);
  const a = Math.abs(s);
  if (a >= 0.78) return Math.sign(s);
  const x = a / 0.78;
  const smooth = x * x * x * (x * (x * 6 - 15) + 10);
  return Math.sign(s) * smooth;
}

function clampAxis(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

function dampPtr(current: number, target: number): number {
  if (Math.abs(target - current) < 0.012) return target;
  return current + (target - current) * 0.25;
}

function floatTransform(tx: number, ty: number, tz: number, ry: number, rx: number, rz: number): string {
  return `perspective(780px) translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, ${tz.toFixed(2)}px) ` +
    `rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
}

/** Y travel stays inside the rail gap so the blue card and the orange sector card cannot cross. */
function poseFloatWrap(
  wrap: HTMLDivElement,
  t: number,
  phase: number,
  amp: number,
  px: number,
  py: number,
  baseRy: number,
  baseRx: number,
  baseRz: number,
  hovered: boolean,
): void {
  const rotSin = Math.sin(t * 0.24 + phase);
  const rotCos = Math.cos(t * 0.48 + phase);
  const tx = clampAxis(rotSin * 3.8 * amp - px * 8 * amp, 10);
  const ty = clampAxis(rotCos * 4.2 * amp + py * 4 * amp, 5);
  const tz = rotCos * 12 * amp + (hovered ? 12 : 0);
  const ry = baseRy + rotSin * 2.4 * amp + px * 3.2;
  const rx = baseRx + rotCos * 1.2 * amp + py * 1.6;
  const rz = baseRz + rotSin * 0.45 * amp;
  wrap.style.transform = floatTransform(tx, ty, tz, ry, rx, rz);
}

function createFloatWrapper(wrapClass: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = `ar-float-wrap ${wrapClass}`;
  const back = document.createElement('div');
  back.className = 'ar-holo-back plate';
  back.setAttribute('aria-hidden', 'true');
  wrap.appendChild(back);
  return wrap;
}

/**
 * Ship Enchanted-Reality (AR) 3D HUD overlay around the orbital globe:
 * - Left flank (`ar-card-scan`): world scan & biome characteristics
 * - Upper-right flank (`ar-card-presence`): real live players, AI bots, & open drop zones
 * - Lower-right flank (`ar-card-launch`): landing sector picker & DEPLOY control
 * - Full-screen SVG layer connecting all 3 floating 3D cards to live rotated 3D points on the globe.
 */
export class OrbitalArHud {
  readonly el = document.createElement('div');
  private readonly leaderLines: ArLeaderLines;
  private readonly scanWrap = createFloatWrapper('ar-wrap-scan');
  private readonly rightRail = document.createElement('div');
  private readonly presenceWrap = createFloatWrapper('ar-wrap-presence');
  private readonly launchWrap = createFloatWrapper('ar-wrap-launch');
  private readonly scanCard = document.createElement('section');
  private readonly presenceCard = document.createElement('section');
  private readonly launchCard = document.createElement('section');
  private sectorHostEl!: HTMLElement;
  private deployBtn!: HTMLButtonElement;
  private errEl!: HTMLElement;
  private hoveredSectorId: string | null = null;
  private hoveredCard: ArCardKey | null = null;
  private localPtrX = 0;
  private localPtrY = 0;
  private smoothPtrX = 0;
  private smoothPtrY = 0;
  private launchPtrX = 0;
  private launchPtrY = 0;
  private launchWaveNow = 0;
  private lastLaunchTransform = '';
  private lastKind: PlanetKind | null = null;
  private lastScanHtml = '';
  private lastPresenceHtml = '';
  private lastSectorHtml = '';
  private cachedMarkers: OrbitalGlobeMarkerInput[] = [];
  private latestState: OrbitalArState;
  private pulseTimer = 0;
  private sectorLockNoticeShown = false;
  private rebindingSectors = false;
  private railMotion = 1;

  private readonly onPointerMove = (e: PointerEvent): void => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.localPtrX = (e.clientX / w) * 2 - 1;
    this.localPtrY = -((e.clientY / h) * 2 - 1);
  };

  constructor(
    parent: HTMLElement,
    initial: OrbitalArState,
    private readonly cb: OrbitalArHudCallbacks,
  ) {
    this.latestState = initial;
    this.el.className = 'orbital-ar-hud';
    this.el.dataset.testid = 'orbital-ar-hud';

    this.leaderLines = new ArLeaderLines(this.el);

    this.scanCard.className = 'ar-card ar-card-scan plate';
    this.scanCard.dataset.testid = 'ar-card-scan';
    this.scanWrap.appendChild(this.scanCard);

    this.rightRail.className = 'ar-right-rail';
    this.presenceCard.className = 'ar-card ar-card-presence plate';
    this.presenceCard.dataset.testid = 'ar-card-presence';
    this.presenceWrap.appendChild(this.presenceCard);

    this.launchCard.className = 'ar-card ar-card-launch plate';
    this.launchCard.dataset.testid = 'ar-card-launch';
    this.launchWrap.appendChild(this.launchCard);

    this.rightRail.append(this.presenceWrap, this.launchWrap);
    this.el.append(this.scanWrap, this.rightRail);
    parent.appendChild(this.el);

    this.launchCard.innerHTML = renderLaunchCardShellHtml(
      initial.kind,
      initial.summary,
      initial.intent,
      initial.queuePaused,
      initial.activeColony,
      resolveHomeBaseSectorId(initial.summary, initial.activeColony),
    );
    this.sectorHostEl = this.launchCard.querySelector('#sector-picker-host')!;
    this.deployBtn = this.launchCard.querySelector('#deploy')!;
    this.errEl = this.launchCard.querySelector('#menu-err')!;
    this.deployBtn.onclick = () => {
      if (this.deployBtn.disabled || this.isForeignSectorSelected()) return;
      this.deployBtn.disabled = true;
      this.cb.onDeploy();
    };

    this.bindHoverDepth();
    if (typeof window !== 'undefined') window.addEventListener('pointermove', this.onPointerMove);
    this.update(initial);
  }

  private bindHoverDepth(): void {
    const entries: Array<[HTMLElement, ArCardKey]> = [
      [this.scanCard, 'scan'],
      [this.presenceCard, 'presence'],
      [this.launchCard, 'launch'],
    ];
    for (const [card, key] of entries) {
      card.addEventListener('pointerenter', () => {
        this.hoveredCard = key;
        this.applyPointerIsolation();
      });
      card.addEventListener('pointerleave', (ev: Event) => {
        if (this.hoveredCard !== key) return;
        const next = (ev as PointerEvent).relatedTarget;
        if (next instanceof Node && card.contains(next)) return;
        this.hoveredCard = null;
        this.applyPointerIsolation();
      });
    }
  }

  /** The card under the pointer keeps the hit target. The other two cannot steal a sector click. */
  private applyPointerIsolation(): void {
    const active = this.hoveredCard;
    const wraps: Record<ArCardKey, HTMLElement> = {
      scan: this.scanWrap,
      presence: this.presenceWrap,
      launch: this.launchWrap,
    };
    const cards: Record<ArCardKey, HTMLElement> = {
      scan: this.scanCard,
      presence: this.presenceCard,
      launch: this.launchCard,
    };
    for (const key of ['scan', 'presence', 'launch'] as const) {
      const hot = active === key;
      cards[key].style.pointerEvents = active !== null && !hot ? 'none' : '';
      wraps[key].style.zIndex = hot ? '4' : key === 'launch' ? '2' : '1';
    }
  }

  private stepRailMotion(held: boolean): number {
    const target = held ? 0 : 1;
    this.railMotion += (target - this.railMotion) * 0.3;
    if (Math.abs(this.railMotion - target) < 0.015) this.railMotion = target;
    return this.railMotion;
  }

  getDeployButton(): HTMLButtonElement {
    return this.deployBtn;
  }

  getErrorElement(): HTMLElement {
    return this.errEl;
  }

  getSectorHost(): HTMLElement {
    return this.sectorHostEl;
  }

  getGlobeMarkers(): readonly OrbitalGlobeMarkerInput[] {
    return this.cachedMarkers;
  }

  update(state: OrbitalArState): void {
    const planetChanged = this.lastKind !== null && this.lastKind !== state.kind;
    this.lastKind = state.kind;
    this.latestState = state;

    const scanHtml = renderScanCardInnerHtml(state.kind, state.summary);
    if (scanHtml !== this.lastScanHtml) {
      this.scanCard.innerHTML = scanHtml;
      this.lastScanHtml = scanHtml;
    }
    const homeBaseSectorId = resolveHomeBaseSectorId(state.summary, state.activeColony);
    const targetSector = resolveTargetSectorId(
      state.summary,
      state.intent,
      this.hoveredSectorId,
      state.activeColony ? homeBaseSectorId : null,
    );
    const presenceHtml = renderPresenceCardInnerHtml(
      state.summary,
      state.activeColony,
      targetSector,
      homeBaseSectorId,
    );
    if (presenceHtml !== this.lastPresenceHtml) {
      this.presenceCard.innerHTML = presenceHtml;
      this.lastPresenceHtml = presenceHtml;
    }

    const launchBadge = this.launchCard.querySelector<HTMLElement>('.ar-eyebrow .ar-code');
    if (launchBadge) launchBadge.textContent = state.summary.availability.toUpperCase();
    this.sectorHostEl.hidden = false;
    const sectorHtml = renderSectorChooserHtml(
      state.kind,
      state.summary,
      state.intent,
      state.queuePaused,
      homeBaseSectorId,
    );
    if (sectorHtml !== this.lastSectorHtml) {
      this.rebindingSectors = true;
      this.sectorHostEl.innerHTML = sectorHtml;
      this.lastSectorHtml = sectorHtml;
      bindSectorChooserEvents(
        this.sectorHostEl,
        (intent) => this.cb.onSectorSelect(intent),
        (sectorId) => this.previewSector(sectorId),
      );
      this.rebindingSectors = false;
    }
    this.syncLockState();

    this.refreshMarkers();
    if (planetChanged) this.triggerRetargetPulse();
  }

  isForeignSectorSelected(): boolean {
    const { summary, intent, activeColony } = this.latestState;
    if (!activeColony) return false;
    const homeBaseSectorId = resolveHomeBaseSectorId(summary, activeColony);
    if (!homeBaseSectorId) return false;
    return intent.mode === 'chosen' && intent.sectorId !== homeBaseSectorId;
  }

  syncLockState(): void {
    const { summary, activeColony } = this.latestState;
    this.deployBtn.textContent = activeColony ? 'ENTER COLONY' : 'DEPLOY';
    if (!activeColony) {
      this.deployBtn.disabled = false;
      this.deployBtn.removeAttribute('aria-disabled');
      delete this.deployBtn.dataset.sectorLocked;
      if (this.sectorLockNoticeShown) {
        this.errEl.textContent = '';
        this.sectorLockNoticeShown = false;
      }
      return;
    }
    const homeBaseSectorId = resolveHomeBaseSectorId(summary, activeColony);
    const foreignSector = this.isForeignSectorSelected();
    this.deployBtn.disabled = foreignSector;
    this.deployBtn.setAttribute('aria-disabled', foreignSector ? 'true' : 'false');
    this.deployBtn.dataset.sectorLocked = foreignSector ? 'true' : 'false';
    if (foreignSector && homeBaseSectorId) {
      this.errEl.textContent =
        `Colony ${activeColony.colonyName} is deployed in ${homeBaseSectorId.toUpperCase()} — select ${homeBaseSectorId.toUpperCase()} to enter.`;
      this.sectorLockNoticeShown = true;
    } else if (this.sectorLockNoticeShown) {
      this.errEl.textContent = '';
      this.sectorLockNoticeShown = false;
    }
  }

  private previewSector(sectorId: string | null): void {
    if (sectorId === null && this.rebindingSectors) return;
    this.hoveredSectorId = sectorId;
    this.refreshPresence();
    this.refreshMarkers();
    this.cb.onMarkerHover?.(sectorId);
  }

  private refreshPresence(): void {
    const homeBaseSectorId = resolveHomeBaseSectorId(this.latestState.summary, this.latestState.activeColony);
    const targetSector = resolveTargetSectorId(
      this.latestState.summary,
      this.latestState.intent,
      this.hoveredSectorId,
      this.latestState.activeColony ? homeBaseSectorId : null,
    );
    const presenceHtml = renderPresenceCardInnerHtml(
      this.latestState.summary,
      this.latestState.activeColony,
      targetSector,
      homeBaseSectorId,
    );
    if (presenceHtml !== this.lastPresenceHtml) {
      this.presenceCard.innerHTML = presenceHtml;
      this.lastPresenceHtml = presenceHtml;
    }
  }

  private update3dFloat(frame: OrbitalProjectedFrame | null): void {
    this.smoothPtrX += (this.localPtrX - this.smoothPtrX) * 0.14;
    this.smoothPtrY += (this.localPtrY - this.smoothPtrY) * 0.14;
    const px = frame?.pointerX ?? this.smoothPtrX;
    const py = frame?.pointerY ?? this.smoothPtrY;
    const reduced = prefersReducedMotion();
    const t = reduced ? 0 : (frame?.time ?? (typeof performance !== 'undefined' ? performance.now() * 0.001 : 0));
    const launchHovered = this.hoveredCard === 'launch' || this.launchCard.matches(':hover');
    const presenceHovered = this.hoveredCard === 'presence';
    const motion = this.stepRailMotion(launchHovered || presenceHovered);

    poseFloatWrap(this.scanWrap, t, 0, reduced ? 0 : 1, px, py, 16.5, -2.2, -0.5, this.hoveredCard === 'scan');
    if (!presenceHovered) {
      poseFloatWrap(this.presenceWrap, t, 0, (reduced ? 0 : 0.94) * motion, px, py, -16.5, -2, 0.5, false);
    }
    this.poseLaunch(px, py, t, reduced, launchHovered, launchHovered ? 1 : motion);
  }

  private poseLaunch(px: number, py: number, t: number, reduced: boolean, held: boolean, slide: number): void {
    if (reduced) {
      this.launchWaveNow = 0;
      this.launchPtrX = 0;
      this.launchPtrY = 0;
    } else if (!held) {
      this.launchWaveNow = gyroDwellWave(t * 0.96);
      this.launchPtrX = dampPtr(this.launchPtrX, px);
      this.launchPtrY = dampPtr(this.launchPtrY, py);
    }
    const w = (reduced ? 0 : this.launchWaveNow) * slide;
    const lpx = Math.round(this.launchPtrX * 50) / 50;
    const lpy = Math.round(this.launchPtrY * 50) / 50;
    const transform = floatTransform(
      clampAxis((w * 3 - lpx * 6) * slide, 10),
      clampAxis((w * 3.2 + lpy * 3.2) * slide, 5),
      w * 10.5,
      -15 + w * 2.1 + lpx * 2.4 * slide,
      2.8 + w * 1.1 + lpy * 1.4 * slide,
      -0.35 + w * 0.35,
    );
    if (transform === this.lastLaunchTransform) return;
    this.lastLaunchTransform = transform;
    this.launchWrap.style.transform = transform;
  }

  syncProjection(frame: OrbitalProjectedFrame | null): void {
    this.update3dFloat(frame);
    const { summary, intent, activeColony } = this.latestState;
    const homeBaseSectorId = resolveHomeBaseSectorId(summary, activeColony);
    const targetSector = resolveTargetSectorId(
      summary,
      intent,
      this.hoveredSectorId,
      activeColony ? homeBaseSectorId : null,
    );
    const selectedSectorLabel = `SECTOR // ${targetSector}`;
    const homeBaseLabel = homeBaseSectorId ? `ACTIVE BASE · ${homeBaseSectorId}` : `DROP // ${targetSector}`;

    this.leaderLines.render(
      {
        scanCard: this.scanCard,
        presenceCard: this.presenceCard,
        launchCard: this.launchCard,
      },
      frame,
      {
        selectedSectorLabel,
        homeBaseLabel,
      },
    );
  }

  private refreshMarkers(): void {
    const { summary, intent, kind, activeColony } = this.latestState;
    this.cachedMarkers = buildOrbitalGlobeMarkers(
      summary,
      intent,
      this.hoveredSectorId,
      kind,
      activeColony,
    );
  }

  private triggerRetargetPulse(): void {
    clearTimeout(this.pulseTimer);
    this.el.classList.remove('is-retargeting');
    void this.el.offsetWidth;
    this.el.classList.add('is-retargeting');
    this.pulseTimer = window.setTimeout(() => {
      this.el.classList.remove('is-retargeting');
    }, 420);
  }

  dispose(): void {
    clearTimeout(this.pulseTimer);
    if (typeof window !== 'undefined') window.removeEventListener('pointermove', this.onPointerMove);
    this.leaderLines.dispose();
    this.el.remove();
  }
}
