import { createColonyViewport, type ColonyViewport } from '@terra/render/core/createColonyViewport';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { EntityCardSpec } from './data/entitiesCatalog';
import { createCustomShaderRig, createRainWeatherRig } from './shaderRigs';
import {
  createArchetypeRig,
  createCombatFxRig,
  createProjectileFxRig,
  createRingFxRig,
  createWeatherFxRig,
  createWorkFxRig,
  type ActivePreviewRig,
  type CardControlState,
  type CardSlot,
} from './stageRigs';

export type { CardControlState };

const STAGE_W = 464;
const STAGE_H = 290;

function drawCanvasFallback(canvas: HTMLCanvasElement, label: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 106, 19, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.font = '600 12px monospace';
  ctx.fillStyle = '#39D0FF';
  ctx.fillText(`TELEMETRY // ${label}`, 24, 38);
}

export class WhitepaperLiveStage3D {
  private vp: ColonyViewport | null = null;
  private hostEl: HTMLDivElement | null = null;
  private biome: PlanetKind = 'dune';
  private readonly slots = new Map<string, CardSlot>();
  private activeCardId: string | null = null;
  private activeRig: ActivePreviewRig | null = null;
  private observer: IntersectionObserver | null = null;
  private rafId = 0;
  private lastTs = 0;
  private webglFailed = false;
  private readonly onStatusChange?: (status: string) => void;
  private readonly onCardsChangedBound = () => this.enqueueVisibleSlots();

  constructor(onStatusChange?: (status: string) => void) {
    this.onStatusChange = onStatusChange;
    window.addEventListener('wp:cards-changed', this.onCardsChangedBound);
  }

  registerCard(spec: EntityCardSpec, cardEl: HTMLElement, canvas: HTMLCanvasElement): void {
    const slot: CardSlot = {
      spec,
      cardEl,
      canvas,
      state: {
        action: spec.defaultAction ?? 'idle',
        stage: 'full',
      },
      renderedKey: '',
      needsRender: true,
    };
    this.slots.set(spec.id, slot);
    this.ensureObserver().observe(cardEl);
    this.scheduleTick();

    const stage = cardEl.querySelector<HTMLElement>('.wp-card3d-stage');
    stage?.addEventListener('pointerenter', () => this.setActiveCard(spec.id));
    stage?.addEventListener('pointerleave', () => {
      if (this.activeCardId === spec.id) this.setActiveCard(null);
    });
    stage?.addEventListener('click', () => {
      this.setActiveCard(this.activeCardId === spec.id ? null : spec.id);
    });
  }

  setBiome(biome: PlanetKind): void {
    if (this.biome === biome) return;
    this.biome = biome;
    if (this.vp) this.vp.applySky(PLANET_SPECS[biome]);
    for (const slot of this.slots.values()) {
      slot.renderedKey = '';
      if (!slot.cardEl.hidden) slot.needsRender = true;
    }
    this.disposeActiveRig();
    this.scheduleTick();
  }

  updateCardState(id: string, patch: Partial<CardControlState>): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.state = { ...slot.state, ...patch };
    slot.renderedKey = '';
    slot.needsRender = true;
    if (this.activeCardId === id) this.disposeActiveRig();
    this.setActiveCard(id);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('wp:cards-changed', this.onCardsChangedBound);
    this.observer?.disconnect();
    this.disposeActiveRig();
    this.vp?.dispose();
    this.hostEl?.remove();
    this.vp = null;
    this.hostEl = null;
  }

  private enqueueVisibleSlots(): void {
    for (const slot of this.slots.values()) {
      if (!slot.cardEl.hidden && slot.renderedKey !== this.keyFor(slot)) {
        slot.needsRender = true;
      }
    }
    this.scheduleTick();
  }

  private isElementNearViewport(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.bottom >= -200 && rect.top <= window.innerHeight + 250;
  }

  private ensureObserver(): IntersectionObserver {
    if (this.observer) return this.observer;
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.cardId;
        const slot = id ? this.slots.get(id) : undefined;
        if (slot && slot.renderedKey !== this.keyFor(slot)) {
          slot.needsRender = true;
          this.scheduleTick();
        }
      }
    }, { rootMargin: '260px 0px' });
    return this.observer;
  }

  private ensureViewport(): ColonyViewport | null {
    if (this.webglFailed) return null;
    if (this.vp) return this.vp;
    try {
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;left:-9999px;top:0;width:464px;height:290px;pointer-events:none;opacity:0;';
      document.body.appendChild(div);
      const vp = createColonyViewport(div);
      vp.setResolution({ width: STAGE_W, height: STAGE_H }, 1);
      vp.applySky(PLANET_SPECS[this.biome]);
      this.hostEl = div;
      this.vp = vp;
      this.onStatusChange?.('WEBGL 3D');
      return vp;
    } catch {
      this.webglFailed = true;
      this.onStatusChange?.('2D FALLBACK');
      return null;
    }
  }

  private keyFor(slot: CardSlot): string {
    return `${this.biome}|${slot.state.action}|${slot.state.stage}`;
  }

  private setActiveCard(id: string | null): void {
    if (this.activeCardId) {
      this.slots.get(this.activeCardId)?.cardEl.classList.remove('is-animating');
    }
    this.activeCardId = id;
    if (id) this.slots.get(id)?.cardEl.classList.add('is-animating');
    this.scheduleTick();
  }

  private mountRig(slot: CardSlot, vp: ColonyViewport): ActivePreviewRig {
    const key = this.keyFor(slot);
    let inner;
    if (slot.spec.renderKind === 'workFx') inner = createWorkFxRig(slot, this.biome, vp);
    else if (slot.spec.renderKind === 'combatFx') inner = createCombatFxRig(slot, vp);
    else if (slot.spec.renderKind === 'weatherFx') {
      inner = slot.spec.weatherKind === 'rain'
        ? createRainWeatherRig(this.biome, vp)
        : createWeatherFxRig(slot, vp);
    } else if (slot.spec.renderKind === 'customShaderFx') {
      inner = createCustomShaderRig(slot.spec.shaderKind ?? 'water', this.biome, vp);
    } else if (slot.spec.renderKind === 'projectileFx') inner = createProjectileFxRig(this.biome, vp);
    else if (slot.spec.renderKind === 'ringFx') inner = createRingFxRig(this.biome, vp);
    else inner = createArchetypeRig(slot, this.biome, vp);
    return { ...inner, slot, key };
  }

  private blitToCard(vp: ColonyViewport, slot: CardSlot): void {
    const ctx = slot.canvas.getContext('2d');
    if (!ctx) return;
    if (slot.canvas.width !== STAGE_W || slot.canvas.height !== STAGE_H) {
      slot.canvas.width = STAGE_W;
      slot.canvas.height = STAGE_H;
    }
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    ctx.drawImage(vp.renderer.domElement, 0, 0, STAGE_W, STAGE_H);
  }

  private disposeActiveRig(): void {
    this.activeRig?.dispose();
    this.activeRig = null;
  }

  private scheduleTick(): void {
    if (this.rafId) return;
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame((ts) => this.tick(ts));
  }

  private snapshotSlot(slot: CardSlot, vp: ColonyViewport): void {
    this.disposeActiveRig();
    try {
      const rig = this.mountRig(slot, vp);
      rig.step(0.016);
      vp.render();
      this.blitToCard(vp, slot);
      slot.renderedKey = rig.key;
      rig.dispose();
    } catch (err) {
      console.warn('[whitepaper-3d-fallback]', slot.spec.id, err);
      drawCanvasFallback(slot.canvas, slot.spec.targetId);
      slot.renderedKey = this.keyFor(slot);
    }
    slot.needsRender = false;
  }

  private isElementInViewport(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }

  private renderPendingSnapshots(vp: ColonyViewport): void {
    let snapshots = 0;
    const allSlots = Array.from(this.slots.values());
    const isStale = (slot: CardSlot): boolean =>
      !slot.cardEl.hidden
      && slot.spec.id !== this.activeCardId
      && (slot.needsRender || slot.renderedKey !== this.keyFor(slot));

    // Priority 1: strictly visible inside current viewport (render all visible, up to 8 per frame)
    for (const slot of allSlots) {
      if (!isStale(slot) || !this.isElementInViewport(slot.cardEl)) continue;
      this.snapshotSlot(slot, vp);
      snapshots++;
      if (snapshots >= 8) return;
    }

    // Priority 2: near-viewport pre-warm slots
    for (const slot of allSlots) {
      if (!isStale(slot) || !this.isElementNearViewport(slot.cardEl)) continue;
      this.snapshotSlot(slot, vp);
      snapshots++;
      if (snapshots >= 3) return;
    }

    // Priority 3: remaining off-screen dirty/stale slots in background when not hovering
    if (!this.activeCardId) {
      for (const slot of allSlots) {
        if (!isStale(slot)) continue;
        this.snapshotSlot(slot, vp);
        snapshots++;
        if (snapshots >= 2) return;
      }
    }
  }

  private tick(ts: number): void {
    this.rafId = 0;
    const dt = Math.min(0.05, Math.max(0.008, (ts - this.lastTs) / 1000));
    this.lastTs = ts;
    const vp = this.ensureViewport();

    if (!vp) {
      for (const slot of this.slots.values()) {
        if (slot.needsRender) {
          slot.needsRender = false;
          drawCanvasFallback(slot.canvas, slot.spec.targetId);
        }
      }
      return;
    }

    this.renderPendingSnapshots(vp);

    if (this.activeCardId) {
      const slot = this.slots.get(this.activeCardId);
      if (slot) {
        const key = this.keyFor(slot);
        if (!this.activeRig || this.activeRig.slot.spec.id !== slot.spec.id || this.activeRig.key !== key) {
          this.disposeActiveRig();
          this.activeRig = this.mountRig(slot, vp);
        }
        this.activeRig.step(dt);
        vp.render();
        this.blitToCard(vp, slot);
        slot.renderedKey = key;
        slot.needsRender = false;
      }
    }

    const morePending = Array.from(this.slots.values()).some(
      (s) => !s.cardEl.hidden && (s.needsRender || s.renderedKey !== this.keyFor(s)),
    );
    if (morePending || this.activeCardId) this.scheduleTick();
  }
}
