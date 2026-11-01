import { resolveHqT1Row, resolveHubCost, type CompiledDataLike, type ConstructionOrder } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { dispatchCommand, type CommandSink, type InProcessHost } from '../shared/commandDispatch';
import { isHotkeyPress } from '../shared/hotkeys';
import { bindExclusivePointer, resolvePointerTile, type TilePickerFn } from '../shared/pointer';
import { formatCost } from '../shared/resources';
import {
  evaluateHubGhost,
  extractColonyConstructionOrders,
  findValidHubSiteNearHq,
  type GhostSource,
  type HubGhostState,
} from './GhostEvaluator';
import { HubPlacementView } from './HubPlacementView';

export { formatGhostOps, formatGhostYields } from './HubPlacementView';
export type { TilePickerFn };

export interface HubPlacementCommandSink extends CommandSink {
  store?: CommandSink['store'] & {
    latest?: GameView | null;
    latestTiles?: ClientTiles | null;
    simData?(): CompiledDataLike | null; // the host's live balance data (WorldStore), so the ghost uses the same numbers
  };
  /** Authoritative in-process host (tests / tools): the ghost reads its state, commands go through `submit`. */
  host?: Pick<InProcessHost, 'state' | 'view' | 'submit'>;
  /** Called when the authoritative host rejects a placement the ghost accepted (stale view, race with another player). */
  onReject?: (code: string, detail?: string) => void;
  getColonyId?: () => number;
  requireHq?: boolean;
  onChange?: () => void;
}

/**
 * Construction menu v0 controller: the Command Hub placement ghost (evaluated with the sim's shared placement rule),
 * confirm / cancel, and the colony's open Hub order. While placing, map clicks belong to placement only.
 */
export class HubPlacementMenu {
  readonly el: HTMLElement;
  readonly ghostEl: HTMLElement;
  private readonly view: HubPlacementView;
  private active = false;
  private hoveredQ = 0;
  private hoveredR = 0;
  private serverReject: { q: number; r: number; code: string; text: string } | null = null;
  private currentView: GhostSource = null;
  private cachedTiles: ClientTiles | null = null;
  private ghostState: HubGhostState;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    private readonly sink: HubPlacementCommandSink = {},
  ) {
    this.view = new HubPlacementView(parent, {
      startPlacement: () => this.startPlacement(),
      confirmPlacement: () => this.confirmPlacement(),
      cancelPlacement: () => this.cancelPlacement(),
      cancelOrder: () => this.cancelOrder(),
    });
    this.el = this.view.el;
    this.ghostEl = this.view.ghostEl;
    this.bindKeyboard();
    this.ghostState = this.evaluateCurrent(false);
    this.render();
  }

  private bindKeyboard(): void {
    const onKey = (e: KeyboardEvent) => {
      if (!isHotkeyPress(e)) return;
      const key = (e.key ?? '').toLowerCase();
      if (key === 'escape' && this.active) {
        // Capture phase + stop: Esc that closes the ghost never also pauses the game (FF-11).
        e.stopImmediatePropagation();
        this.cancelPlacement();
      } else if (key === 'h' && !this.el.hidden) this.startPlacement();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    this.cleanups.push(() => window.removeEventListener('keydown', onKey, { capture: true }));
  }

  private simData(): CompiledDataLike | undefined {
    return this.sink.store?.simData?.() ?? undefined;
  }

  private resolveSource(): GhostSource {
    if (this.sink.host?.state) return this.sink.host.state;
    if (this.currentView) return this.currentView;
    if (this.sink.store?.latest) return this.sink.store.latest;
    if (this.sink.host) return this.sink.host.view();
    return null;
  }

  private resolveColonyId(): number {
    return this.sink.getColonyId?.() ?? 0;
  }

  private evaluateAt(q: number, r: number, active: boolean): HubGhostState {
    return evaluateHubGhost(this.resolveSource(), {
      colonyId: this.resolveColonyId(),
      q,
      r,
      active,
      requireHq: this.sink.requireHq,
      data: this.simData(),
      fallbackTiles: this.cachedTiles ?? this.sink.store?.latestTiles ?? null,
    });
  }

  private evaluateCurrent(active = this.active): HubGhostState {
    const g = this.evaluateAt(this.hoveredQ, this.hoveredR, active);
    const rej = this.serverReject;
    if (!g.valid || !rej || rej.q !== g.q || rej.r !== g.r) return g;
    return { ...g, valid: false, tint: 'invalid', reasonCode: rej.code, reasonText: rej.text };
  }

  setView(view: GhostSource): void {
    if (view && typeof view === 'object' && 'tiles' in view && view.tiles) {
      this.cachedTiles = view.tiles as ClientTiles;
    }
    this.currentView = view;
    if (this.active) this.ghostState = this.evaluateCurrent(true);
    this.render();
  }

  startPlacement(q?: number, r?: number): HubGhostState {
    this.active = true;
    if (typeof q === 'number' && typeof r === 'number') {
      this.hoveredQ = Math.trunc(q);
      this.hoveredR = Math.trunc(r);
    } else {
      const fallback = this.cachedTiles ?? this.sink.store?.latestTiles ?? null;
      const near = findValidHubSiteNearHq(this.resolveSource(), this.resolveColonyId(), fallback, this.simData());
      if (near) {
        this.hoveredQ = near.q;
        this.hoveredR = near.r;
      }
    }
    return this.refresh(true);
  }

  hoverTile(q: number, r: number): HubGhostState {
    this.hoveredQ = Math.trunc(q);
    this.hoveredR = Math.trunc(r);
    return this.refresh(this.active);
  }

  private refresh(active: boolean): HubGhostState {
    this.ghostState = this.evaluateCurrent(active);
    this.render();
    this.sink.onChange?.();
    return this.ghostState;
  }

  confirmPlacement(q?: number, r?: number): boolean {
    if (typeof q === 'number' && typeof r === 'number') {
      this.hoveredQ = Math.trunc(q);
      this.hoveredR = Math.trunc(r);
    }
    this.ghostState = this.evaluateCurrent(true);
    if (!this.ghostState.valid) {
      this.render();
      return false;
    }

    const { q: siteQ, r: siteR } = this.ghostState;
    const sent = dispatchCommand(this.sink, 'placeBuilding', { building: 'commandHub', q: siteQ, r: siteR }, this.resolveColonyId());
    void sent.result.then((res) => {
      // No verdict on timeout / disconnect (the order may have landed): don't paint a red ghost over it.
      if (res && res.ok === false && res.code !== 'timeout' && res.code !== 'not_connected') this.onServerReject(siteQ, siteR, res.code ?? 'site_blocked', res.detail);
    });

    this.active = false;
    this.serverReject = null;
    this.refresh(false);
    return true;
  }

  /**
   * The host disagreed with the ghost (its view was newer): reopen the ghost on that site with the host's reason. The
   * ghost re-evaluates on the newest view; when it now agrees on the code, its own block text is shown (FF-17).
   */
  private onServerReject(q: number, r: number, code: string, detail?: string): void {
    const fresh = this.evaluateAt(q, r, true);
    const text = !fresh.valid && fresh.reasonCode === code && fresh.reasonText ? fresh.reasonText : (detail ?? code.replace(/_/g, ' '));
    this.serverReject = { q, r, code, text };
    this.active = true;
    this.hoveredQ = q;
    this.hoveredR = r;
    this.refresh(true);
    this.sink.onReject?.(code, detail);
  }

  cancelPlacement(): void {
    this.active = false;
    this.serverReject = null;
    this.refresh(false);
  }

  /** The colony's open construction order in the view (completed and cancelled ones are history). */
  private openOrder(): ConstructionOrder | undefined {
    return extractColonyConstructionOrders(this.resolveSource(), this.resolveColonyId())[0];
  }

  /** Cancels the host order `orderId` (default: the open Hub order in the view); never sends a wildcard. */
  cancelOrder(orderId?: string): boolean {
    const id = orderId ?? this.openOrder()?.orderId;
    if (!id) return false;
    dispatchCommand(this.sink, 'cancelTask', { taskId: id }, this.resolveColonyId());
    this.refresh(this.active);
    return true;
  }

  isPlacementActive(): boolean { return this.active; }

  /** Cached ghost state (no re-evaluation or DOM work): safe per frame. */
  peekGhostState(): HubGhostState { return this.ghostState; }

  getGhostState(): HubGhostState {
    this.ghostState = this.evaluateCurrent(this.active);
    this.render();
    return this.ghostState;
  }

  /**
   * Map clicks while placing: left click confirms on the clicked tile, right click / context menu cancels. They are
   * consumed (HQ selection and orders never see them, FF-10). Hover comes from the 3D renderer's per-frame pick.
   */
  bindSurface(surface: HTMLElement, pickTile?: TilePickerFn): () => void {
    const cleanup = bindExclusivePointer(surface, () => this.active, {
      up: (e) => {
        if (e.button === 2) {
          if (this.active) this.cancelPlacement();
          return;
        }
        const coord = this.active ? resolvePointerTile(e, pickTile) : null;
        if (coord) this.confirmPlacement(coord.q, coord.r);
      },
      context: () => {
        if (this.active) this.cancelPlacement();
      },
    });
    this.cleanups.push(cleanup);
    return cleanup;
  }

  render(): void {
    const data = this.simData();
    this.view.render({
      active: this.active,
      ghost: this.ghostState,
      costText: formatCost(resolveHubCost(data)),
      hqWorkRate: Number(resolveHqT1Row(data).workRate),
      order: this.openOrder(),
    });
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.view.dispose();
  }
}
