import type { PlanetSummaryV1 } from '@terra/contracts';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { OrbitalGlobeMarkerInput, OrbitalProjectedFrame } from '@terra/render/orbit/types';
import type { ActiveHomeColony } from '../../../design/pilot/activeHomeColony';
import { resolvePlanetPopulationCounts, type SectorIntentV1 } from '../lobby/orbitalPickerModel';
import { bindSectorChooserEvents, renderSectorChooserHtml } from '../lobby/sectorChooser';
import {
  renderLaunchCardShellHtml,
  renderPresenceCardInnerHtml,
  renderScanCardInnerHtml,
} from './arHudTemplates';
import { ArLeaderLines } from './arLeaderLines';
import { buildOrbitalGlobeMarkers, resolveTargetSectorId } from './sectorGlobeMap';

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
    );
    this.sectorHostEl = this.launchCard.querySelector('#sector-picker-host')!;
    this.deployBtn = this.launchCard.querySelector('#deploy')!;
    this.errEl = this.launchCard.querySelector('#menu-err')!;
    this.deployBtn.onclick = () => {
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
      card.onpointerenter = () => { this.hoveredCard = key; };
      card.onpointerleave = () => {
        if (this.hoveredCard === key) this.hoveredCard = null;
      };
    }
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
    const presenceHtml = renderPresenceCardInnerHtml(state.summary, state.activeColony);
    if (presenceHtml !== this.lastPresenceHtml) {
      this.presenceCard.innerHTML = presenceHtml;
      this.lastPresenceHtml = presenceHtml;
    }

    const launchBadge = this.launchCard.querySelector<HTMLElement>('.ar-eyebrow .ar-code');
    if (launchBadge) launchBadge.textContent = state.summary.availability.toUpperCase();
    this.sectorHostEl.hidden = Boolean(state.activeColony);
    const sectorHtml = renderSectorChooserHtml(
      state.kind,
      state.summary,
      state.intent,
      state.queuePaused,
    );
    if (sectorHtml !== this.lastSectorHtml) {
      this.sectorHostEl.innerHTML = sectorHtml;
      this.lastSectorHtml = sectorHtml;
      bindSectorChooserEvents(
        this.sectorHostEl,
        (intent) => this.cb.onSectorSelect(intent),
        (sectorId) => {
          this.hoveredSectorId = sectorId;
          this.refreshMarkers();
          this.cb.onMarkerHover?.(sectorId);
        },
      );
    }
    this.deployBtn.textContent = state.activeColony ? 'ENTER COLONY' : 'DEPLOY';

    this.refreshMarkers();
    if (planetChanged) this.triggerRetargetPulse();
  }

  private update3dFloat(frame: OrbitalProjectedFrame | null): void {
    this.smoothPtrX += (this.localPtrX - this.smoothPtrX) * 0.14;
    this.smoothPtrY += (this.localPtrY - this.smoothPtrY) * 0.14;
    const px = frame?.pointerX ?? this.smoothPtrX;
    const py = frame?.pointerY ?? this.smoothPtrY;
    const reduced = prefersReducedMotion();
    const t = reduced ? 0 : (frame?.time ?? (typeof performance !== 'undefined' ? performance.now() * 0.001 : 0));

    const applyContinuous = (
      wrap: HTMLDivElement,
      phase: number,
      amp: number,
      baseRy: number,
      baseRx: number,
      baseRz: number,
      hovered: boolean,
    ) => {
      const tx = Math.sin(t * 0.72 + phase) * 4.4 * amp - px * 10.5 * amp;
      const ty = Math.sin(t * 1.12 + phase) * 6.2 * amp + py * 7.0 * amp;
      const tz = Math.cos(t * 0.88 + phase) * 14.0 * amp + (hovered ? 12 : 0);
      const ry = baseRy + Math.sin(t * 0.65 + phase) * 2.8 * amp + px * 4.6;
      const rx = baseRx + Math.cos(t * 0.82 + phase) * 1.9 * amp + py * 3.2;
      const rz = baseRz + Math.sin(t * 0.50 + phase) * 0.55 * amp;
      wrap.style.transform =
        `perspective(780px) translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, ${tz.toFixed(2)}px) ` +
        `rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
    };

    applyContinuous(this.scanWrap, 0.0, reduced ? 0 : 1.0, 16.5, -2.2, -0.5, this.hoveredCard === 'scan');
    applyContinuous(this.presenceWrap, 2.1, reduced ? 0 : 0.94, -16.5, -2.0, 0.5, this.hoveredCard === 'presence');

    const launchHovered = this.hoveredCard === 'launch' || this.launchCard.matches(':hover');
    if (reduced) {
      this.launchWaveNow = 0;
      this.launchPtrX = 0;
      this.launchPtrY = 0;
    } else if (!launchHovered) {
      this.launchWaveNow = gyroDwellWave(t * 1.48);
      if (Math.abs(px - this.launchPtrX) >= 0.012) {
        this.launchPtrX += (px - this.launchPtrX) * 0.25;
      } else {
        this.launchPtrX = px;
      }
      if (Math.abs(py - this.launchPtrY) >= 0.012) {
        this.launchPtrY += (py - this.launchPtrY) * 0.25;
      } else {
        this.launchPtrY = py;
      }
    }
    const w = reduced ? 0 : this.launchWaveNow;
    const lpx = Math.round(this.launchPtrX * 50) / 50;
    const lpy = Math.round(this.launchPtrY * 50) / 50;
    const ltx = w * 3.0 - lpx * 7.5;
    const lty = w * 4.4 + lpy * 5.0;
    const ltz = w * 10.5;
    const lry = -15.0 + w * 2.1 + lpx * 3.6;
    const lrx = 2.8 + w * 1.4 + lpy * 2.6;
    const lrz = -0.35 + w * 0.35;
    const launchTransform =
      `perspective(780px) translate3d(${ltx.toFixed(2)}px, ${lty.toFixed(2)}px, ${ltz.toFixed(2)}px) ` +
      `rotateY(${lry.toFixed(2)}deg) rotateX(${lrx.toFixed(2)}deg) rotateZ(${lrz.toFixed(2)}deg)`;
    if (launchTransform !== this.lastLaunchTransform) {
      this.lastLaunchTransform = launchTransform;
      this.launchWrap.style.transform = launchTransform;
    }
  }

  syncProjection(frame: OrbitalProjectedFrame | null): void {
    this.update3dFloat(frame);
    const { summary, intent } = this.latestState;
    const pop = resolvePlanetPopulationCounts(summary);
    const targetSector = resolveTargetSectorId(summary, intent, this.hoveredSectorId);
    const targetLabel =
      this.hoveredSectorId !== null
        ? `PREVIEW // ${targetSector}`
        : intent.mode === 'chosen'
          ? `DROP // ${targetSector}`
          : `AUTO // ${targetSector}`;

    this.leaderLines.render(
      {
        scanCard: this.scanCard,
        presenceCard: this.presenceCard,
        launchCard: this.launchCard,
      },
      frame,
      {
        targetLabel,
        showPresenceNodes: pop.players + pop.bots > 0,
      },
    );
  }

  private refreshMarkers(): void {
    const { summary, intent } = this.latestState;
    this.cachedMarkers = buildOrbitalGlobeMarkers(summary, intent, this.hoveredSectorId);
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
