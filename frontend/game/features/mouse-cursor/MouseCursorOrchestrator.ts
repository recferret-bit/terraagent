import { isGameInputBlocked, onGameInputBlockChange } from '../../core/input/gameInputBlock';
import {
  MouseCursorStateMachine,
  type MouseCursorContext,
  type MouseCursorListener,
  type MouseCursorState,
} from '../../core/input/MouseCursorStateMachine';
import { SurfaceCursorApplier } from '../../core/input/cursorVisuals';
import type { ArmyOrdersController } from '../army/ArmyOrdersController';
import type { LandfallController, StoreLike } from '../landfall/selection';
import { resolvePointerTile, type TilePickerFn } from '../shared/pointer';
import { classifyCursorHoverTile, classifyCursorSelection } from './parts/hoverClassifier';

export interface MouseCursorOrchestratorOptions {
  readonly surface?: HTMLElement | null;
  readonly pickTile?: TilePickerFn;
  readonly store?: StoreLike;
  readonly getView?: () => unknown;
  readonly getFallbackTiles?: () => unknown;
  readonly landfall?: () => LandfallController | undefined;
  readonly armyOrders?: () => ArmyOrdersController | undefined;
  readonly getColonyId?: () => number;
  readonly isSpectator?: () => boolean;
  readonly isCombatEnabled?: () => boolean;
  readonly isInputBlocked?: () => boolean;
}

/**
 * Gameplay Mouse Cursor Orchestrator.
 * Composes `MouseCursorStateMachine` (`idle | select | move | attack`), live hover classification,
 * and Faction Plate SVG cursor rendering on the game surface.
 */
export class MouseCursorOrchestrator {
  readonly machine = new MouseCursorStateMachine();
  private readonly applier: SurfaceCursorApplier;
  private readonly cleanups: Array<() => void> = [];
  private latestView: unknown = null;
  private lastTile: { q: number; r: number } | null = null;
  private lastPointerClient: { clientX: number; clientY: number; target: EventTarget | null } | null = null;
  private pointerInside = false;
  private cameraDragging = false;
  private shiftKey = false;
  private disposed = false;
  private pendingMicroRefresh = false;
  private boundLandfall: LandfallController | undefined;
  private offLandfall: (() => void) | null = null;
  private boundArmy: ArmyOrdersController | undefined;
  private offArmy: (() => void) | null = null;

  constructor(private readonly opts: MouseCursorOrchestratorOptions = {}) {
    const surface = opts.surface ?? null;
    this.applier = new SurfaceCursorApplier(surface);
    this.latestView = opts.store?.latest ?? opts.getView?.() ?? null;

    this.cleanups.push(this.machine.onChange((next) => this.applier.apply(next)));
    this.cleanups.push(onGameInputBlockChange(() => this.refresh()));
    this.applier.apply(this.machine.getState());

    if (opts.store?.onView) {
      this.cleanups.push(opts.store.onView((v) => this.onView(v)));
    }
    if (surface) {
      this.cleanups.push(this.bindSurface(surface));
    }
    this.cleanups.push(this.bindWindowSignals());
    this.rebindControllers();
  }

  getState(): MouseCursorState {
    return this.machine.getState();
  }

  getContext(): MouseCursorContext {
    return this.machine.getContext();
  }

  onChange(fn: MouseCursorListener): () => void {
    return this.machine.onChange(fn);
  }

  onView(view: unknown): void {
    this.latestView = view;
    this.rebindControllers();
    if (this.pointerInside) {
      this.repickLastPointer();
      this.refresh();
    }
  }

  /** Programmatically evaluates and transitions cursor state at axial tile `(q, r)` (used by pointer events and tests). */
  evaluateAt(q: number | null, r: number | null, shiftKey = this.shiftKey): MouseCursorState {
    this.rebindControllers();
    this.shiftKey = shiftKey;
    this.lastPointerClient = null;
    if (q === null || r === null || !Number.isFinite(q) || !Number.isFinite(r)) {
      this.lastTile = null;
      const sel = classifyCursorSelection(
        this.opts.landfall?.(),
        this.opts.armyOrders?.(),
        this.isCombatEnabled(),
      );
      return this.machine.transition({
        pointerInside: this.pointerInside,
        inputBlocked: this.isBlocked(),
        cameraDragging: this.cameraDragging,
        spectator: Boolean(this.opts.isSpectator?.()),
        attackMoveArmed: Boolean(this.opts.armyOrders?.()?.isAttackMoveArmed()),
        hasSelectedMovableUnit: sel.hasSelectedMovableUnit,
        hasSelectedArmedUnit: sel.hasSelectedArmedUnit,
        shiftKey: this.shiftKey,
        hoverTarget: 'none',
      });
    }

    this.pointerInside = true;
    this.lastTile = { q, r };
    return this.refresh();
  }

  setPointerInside(inside: boolean): MouseCursorState {
    this.pointerInside = inside;
    if (!inside) {
      this.lastTile = null;
      this.lastPointerClient = null;
    }
    return this.refresh();
  }

  setCameraDragging(dragging: boolean): MouseCursorState {
    if (this.cameraDragging === dragging) return this.machine.getState();
    this.cameraDragging = dragging;
    return this.refresh();
  }

  refresh(): MouseCursorState {
    if (this.disposed) return this.machine.getState();
    this.rebindControllers();
    const landfall = this.opts.landfall?.();
    const armyOrders = this.opts.armyOrders?.();
    const spectator = Boolean(this.opts.isSpectator?.());
    const combatEnabled = this.isCombatEnabled();
    const blocked = this.isBlocked();
    const view = this.latestView ?? this.opts.store?.latest ?? this.opts.getView?.() ?? null;
    const fallbackTiles = this.opts.store?.latestTiles ?? this.opts.getFallbackTiles?.();
    const simData = this.opts.store?.simData?.() ?? null;

    if (!this.pointerInside || blocked || this.cameraDragging || !this.lastTile) {
      const sel = classifyCursorSelection(landfall, armyOrders, combatEnabled);
      return this.machine.transition({
        pointerInside: this.pointerInside,
        inputBlocked: blocked,
        cameraDragging: this.cameraDragging,
        spectator,
        attackMoveArmed: Boolean(armyOrders?.isAttackMoveArmed()),
        hasSelectedMovableUnit: sel.hasSelectedMovableUnit,
        hasSelectedArmedUnit: sel.hasSelectedArmedUnit,
        shiftKey: this.shiftKey,
        hoverTarget: 'none',
      });
    }

    const classified = classifyCursorHoverTile({
      q: this.lastTile.q,
      r: this.lastTile.r,
      view,
      fallbackTiles,
      simData,
      ownerColonyIndex: this.opts.getColonyId?.() ?? landfall?.getOwnerColonyIndex() ?? 0,
      spectator,
      combatEnabled,
      landfall,
      armyOrders,
    });

    return this.machine.transition({
      pointerInside: true,
      inputBlocked: false,
      cameraDragging: false,
      spectator,
      attackMoveArmed: Boolean(armyOrders?.isAttackMoveArmed()),
      hasSelectedMovableUnit: classified.hasSelectedMovableUnit,
      hasSelectedArmedUnit: classified.hasSelectedArmedUnit,
      shiftKey: this.shiftKey,
      hoverTarget: classified.hoverTarget,
    });
  }

  private repickLastPointer(): void {
    if (!this.pointerInside || !this.lastPointerClient || !this.opts.pickTile) return;
    const picked = this.opts.pickTile(
      this.lastPointerClient.clientX,
      this.lastPointerClient.clientY,
      this.lastPointerClient.target,
    );
    this.lastTile = picked ? { q: picked.q, r: picked.r } : null;
  }

  private capturePointerSample(e: MouseEvent, surface: HTMLElement): void {
    const hasDetailTile =
      Boolean(e.detail && typeof e.detail === 'object' && typeof (e.detail as unknown as { q?: unknown }).q === 'number');
    if (hasDetailTile) {
      this.lastPointerClient = null;
    } else if (this.opts.pickTile && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      this.lastPointerClient = { clientX: e.clientX, clientY: e.clientY, target: e.target ?? surface };
    }
    const pick = resolvePointerTile(e, this.opts.pickTile);
    this.lastTile = pick ? { q: pick.q, r: pick.r } : null;
  }

  private scheduleMicroRefresh(): void {
    if (this.pendingMicroRefresh || this.disposed) return;
    this.pendingMicroRefresh = true;
    queueMicrotask(() => {
      this.pendingMicroRefresh = false;
      if (!this.disposed) {
        this.repickLastPointer();
        this.refresh();
      }
    });
  }

  private isCombatEnabled(): boolean {
    if (this.opts.isCombatEnabled) return this.opts.isCombatEnabled();
    return Boolean(this.opts.armyOrders?.());
  }

  private isBlocked(): boolean {
    return Boolean(this.opts.isInputBlocked?.() || isGameInputBlocked());
  }

  private rebindControllers(): void {
    const lf = this.opts.landfall?.();
    if (lf !== this.boundLandfall) {
      this.offLandfall?.();
      this.boundLandfall = lf;
      this.offLandfall = lf ? lf.onChange(() => this.refresh()) : null;
    }
    const army = this.opts.armyOrders?.();
    if (army !== this.boundArmy) {
      this.offArmy?.();
      this.boundArmy = army;
      this.offArmy = army ? army.onChange(() => this.refresh()) : null;
    }
  }

  private bindSurface(surface: HTMLElement): () => void {
    const onMove = (ev: Event) => {
      const e = ev as PointerEvent;
      this.shiftKey = Boolean(e.shiftKey);
      if (e.type === 'pointerdown' && e.button === 1) {
        this.cameraDragging = true;
      } else if (typeof e.buttons === 'number' && e.type === 'pointermove') {
        this.cameraDragging = (e.buttons & 4) !== 0;
      }
      const target = e.target as Node | null;
      if (target && target !== surface && !surface.contains(target)) {
        this.setPointerInside(false);
        return;
      }
      this.pointerInside = true;
      this.capturePointerSample(e, surface);
      this.refresh();
    };

    const onWheel = (ev: Event) => {
      const e = ev as WheelEvent;
      this.shiftKey = Boolean(e.shiftKey);
      const target = e.target as Node | null;
      if (target && target !== surface && !surface.contains(target)) return;
      this.pointerInside = true;
      this.capturePointerSample(e, surface);
      this.scheduleMicroRefresh();
    };

    const onLeave = () => {
      this.setPointerInside(false);
    };

    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerdown', onMove);
    surface.addEventListener('pointerenter', onMove);
    surface.addEventListener('pointerleave', onLeave);
    surface.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerdown', onMove);
      surface.removeEventListener('pointerenter', onMove);
      surface.removeEventListener('pointerleave', onLeave);
      surface.removeEventListener('wheel', onWheel);
    };
  }

  private bindWindowSignals(): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
    const onKeyCapture = (e: KeyboardEvent) => {
      this.shiftKey = Boolean(e.shiftKey);
      this.scheduleMicroRefresh();
    };
    const onPointerDownCapture = (e: PointerEvent) => {
      this.shiftKey = Boolean(e.shiftKey);
      const surface = this.opts.surface;
      const target = e.target as Node | null;
      if (surface && target && (target === surface || surface.contains(target))) {
        if (e.button === 1) this.cameraDragging = true;
        this.pointerInside = true;
        this.capturePointerSample(e, surface);
      }
      this.scheduleMicroRefresh();
    };
    const onPointerUpCapture = (e: PointerEvent) => {
      if (e.button === 1 && this.cameraDragging) {
        this.cameraDragging = false;
      }
      this.scheduleMicroRefresh();
    };
    const onClickCapture = () => {
      this.scheduleMicroRefresh();
    };
    const onContextCapture = () => {
      this.scheduleMicroRefresh();
    };
    const onBlur = () => {
      const changed = this.shiftKey || this.cameraDragging;
      this.shiftKey = false;
      this.cameraDragging = false;
      if (changed) this.refresh();
    };
    const cap = { capture: true };
    window.addEventListener('keydown', onKeyCapture, cap);
    window.addEventListener('keyup', onKeyCapture, cap);
    window.addEventListener('pointerdown', onPointerDownCapture, cap);
    window.addEventListener('pointerup', onPointerUpCapture, cap);
    window.addEventListener('pointercancel', onPointerUpCapture, cap);
    window.addEventListener('click', onClickCapture, cap);
    window.addEventListener('contextmenu', onContextCapture, cap);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyCapture, cap);
      window.removeEventListener('keyup', onKeyCapture, cap);
      window.removeEventListener('pointerdown', onPointerDownCapture, cap);
      window.removeEventListener('pointerup', onPointerUpCapture, cap);
      window.removeEventListener('pointercancel', onPointerUpCapture, cap);
      window.removeEventListener('click', onClickCapture, cap);
      window.removeEventListener('contextmenu', onContextCapture, cap);
      window.removeEventListener('blur', onBlur);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.offLandfall?.();
    this.offLandfall = null;
    this.offArmy?.();
    this.offArmy = null;
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.machine.dispose();
    this.applier.dispose();
  }
}
