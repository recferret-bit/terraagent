import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import type { GameView } from '../../core/registry/types';
import { makeDiv } from '../shared/dom';
import { isHotkeyPress } from '../shared/hotkeys';
import {
  activeOrderOf,
  computeOverlayState,
  extractColonyOrders,
  LIVING_MOVE_SPEED_HINT,
  MAX_OVERLAY_CHIPS,
  type OverlayJobEntry,
  type OverlayOrderProgress,
  type OverlayTileEntry,
  type TileOverlayMode,
  type TileOverlayState,
  type TilePrepStateName,
} from './parts/overlayState';

export {
  activeOrderOf,
  computeOverlayState,
  extractColonyOrders,
  LIVING_MOVE_SPEED_HINT,
  type OverlayJobEntry,
  type OverlayOrderProgress,
  type OverlayTileEntry,
  type TileOverlayMode,
  type TileOverlayState,
  type TilePrepStateName,
};

/**
 * Tile-state overlay. The full state (tile counts, chips) is computed only while the overlay is shown or when asked
 * for; while hidden a view only refreshes the active order (FF-08). Chips are reused between renders.
 */
export class TileOverlay {
  readonly el: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly jobsEl: HTMLElement;
  private readonly chips: HTMLElement[] = [];
  private readonly onKey: (e: KeyboardEvent) => void;
  private visible = false;
  private mode: TileOverlayMode = 'all';
  private lastView: GameView | null = null;
  private state: TileOverlayState | null = null;
  private activeOrder: OverlayOrderProgress | null = null;

  constructor(parent: HTMLElement, private readonly getColonyId: () => number = () => 0) {
    this.el = makeDiv('ta-tf-overlay plate-sm', 'tf-tile-overlay');
    this.el.dataset.visible = 'false';
    this.el.dataset.mode = 'all';
    this.el.dataset.livingHint = '+10 % ground move speed';
    this.el.title = LIVING_MOVE_SPEED_HINT;
    this.el.hidden = true;
    this.summaryEl = makeDiv('ta-tf-overlay__summary label', 'tf-overlay-summary');
    this.summaryEl.title = LIVING_MOVE_SPEED_HINT;
    this.progressEl = makeDiv('ta-tf-overlay__progress mono', 'tf-overlay-progress');
    this.jobsEl = makeDiv('ta-tf-overlay__jobs', 'tf-overlay-jobs');
    this.el.append(this.summaryEl, this.progressEl, this.jobsEl);
    parent.appendChild(this.el);

    this.onKey = (e: KeyboardEvent) => {
      if ((e.key === 'l' || e.key === 'L') && isHotkeyPress(e) && !isGameInputBlocked()) {
        this.toggleLivingMode();
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  setVisible(on?: boolean): boolean {
    this.visible = on ?? !this.visible;
    this.el.hidden = !this.visible;
    this.el.dataset.visible = String(this.visible);
    this.el.dataset.mode = this.mode;
    this.state = null;
    if (this.visible) this.render(this.getState());
    return this.visible;
  }

  toggleLivingMode(on?: boolean): boolean {
    const next = on ?? !(this.visible && this.mode === 'living');
    this.mode = next ? 'living' : 'all';
    this.el.dataset.mode = this.mode;
    return this.setVisible(next);
  }

  getMode(): TileOverlayMode {
    return this.mode;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Full overlay state for the newest view (computed on demand). */
  getState(): TileOverlayState {
    if (!this.state) {
      this.state = computeOverlayState(this.lastView, this.visible, this.getColonyId(), this.mode);
      this.activeOrder = this.state.activeOrder;
    }
    return this.state;
  }

  /** The colony's active order in the newest view; cheap, used by the menu on every view. */
  getActiveOrder(): OverlayOrderProgress | null {
    return this.state ? this.state.activeOrder : this.activeOrder;
  }

  update(view: GameView | null): void {
    if (view) {
      this.lastView = view.tiles
        ? view
        : this.lastView?.tiles
          ? { ...view, tiles: this.lastView.tiles }
          : view;
    }
    this.state = null;
    if (this.visible) this.render(this.getState());
    else this.activeOrder = activeOrderOf(this.lastView, this.getColonyId());
  }

  private render(state: TileOverlayState): void {
    const { counts, activeOrder, tiles } = state;
    this.el.dataset.mode = this.mode;
    this.el.dataset.livingHint = '+10 % ground move speed';
    this.el.title = LIVING_MOVE_SPEED_HINT;
    this.summaryEl.dataset.wild = String(counts.wild);
    this.summaryEl.dataset.flat = String(counts.flat);
    this.summaryEl.dataset.prepared = String(counts.prepared);
    this.summaryEl.dataset.irrigated = String(counts.irrigated);
    this.summaryEl.dataset.living = String(counts.living);
    this.summaryEl.title = LIVING_MOVE_SPEED_HINT;
    this.summaryEl.textContent =
      this.mode === 'living'
        ? `LIVING ${counts.living} · IRRIGATED ${counts.irrigated} · +10 % ground move speed on Living tiles`
        : `WILD ${counts.wild} · FLAT ${counts.flat} · PREPARED ${counts.prepared} · LIVING ${counts.living} · IRRIGATED ${counts.irrigated} · +10 % ground move speed on Living tiles`;
    this.renderProgress(activeOrder);
    this.renderChips(tiles.slice(0, MAX_OVERLAY_CHIPS));
  }

  private renderProgress(activeOrder: OverlayOrderProgress | null): void {
    const d = this.progressEl.dataset;
    if (!activeOrder) {
      d.currentPercent = '0';
      d.overallPercent = '0';
      this.progressEl.textContent = 'IDLE · NO ACTIVE TERRAFORM JOBS';
      return;
    }
    const cur = activeOrder.currentJob;
    d.orderId = activeOrder.orderId;
    d.completedJobs = String(activeOrder.completedJobs);
    d.totalJobs = String(activeOrder.totalJobs);
    d.remainingJobs = String(activeOrder.remainingJobs);
    d.skippedCount = String(activeOrder.skippedCount);
    d.currentPercent = String(cur ? cur.percent : activeOrder.overallPercent);
    d.overallPercent = String(activeOrder.overallPercent);
    const curLabel = cur ? `${cur.op.toUpperCase()} (${cur.q},${cur.r}) ${cur.percent}% · ` : '';
    this.progressEl.textContent = `${activeOrder.completedJobs}/${activeOrder.totalJobs} JOBS · ${curLabel}OVERALL ${activeOrder.overallPercent}%`;
  }

  private renderChips(items: readonly OverlayTileEntry[]): void {
    while (this.chips.length > items.length) this.chips.pop()?.remove();
    items.forEach((item, i) => {
      let chip = this.chips[i];
      if (!chip) {
        chip = makeDiv('ta-tf-overlay__tile mono', 'tf-overlay-tile');
        this.chips.push(chip);
        this.jobsEl.appendChild(chip);
      }
      chip.dataset.q = String(item.q);
      chip.dataset.r = String(item.r);
      chip.dataset.state = item.state;
      chip.dataset.progress = String(item.percent);
      if (item.state === 'living') {
        chip.title = LIVING_MOVE_SPEED_HINT;
        chip.dataset.livingHint = '+10 % ground move speed';
      } else {
        chip.title = '';
        delete chip.dataset.livingHint;
      }
      if (item.op) chip.dataset.op = item.op;
      else delete chip.dataset.op;
      chip.textContent = item.op
        ? `(${item.q},${item.r}) ${item.state.toUpperCase()} · ${item.op.toUpperCase()} ${item.percent}%`
        : `(${item.q},${item.r}) ${item.state.toUpperCase()}`;
    });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}
