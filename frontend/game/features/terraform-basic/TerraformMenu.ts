import type { TerraformOpKind } from '@terra/sim';
import { makeBtn, makeDiv, makeSpan } from '../shared/dom';
import { isHotkeyPress } from '../shared/hotkeys';
import type { BrushController } from './BrushController';
import type { TileOverlay } from './TileOverlay';

const OP_DEFS: ReadonlyArray<{ op: TerraformOpKind; label: string; key: string; testid: string }> = [
  { op: 'grade', label: 'GRADE [G]', key: 'g', testid: 'tf-op-grade' },
  { op: 'clear', label: 'CLEAR [C]', key: 'c', testid: 'tf-op-clear' },
  { op: 'break', label: 'BREAK [B]', key: 'b', testid: 'tf-op-break' },
];

export interface TerraformMenuOptions {
  /** Another map mode owns input (the Hub ghost): the brush hotkeys stay quiet. */
  isBlocked?: () => boolean;
}

export class TerraformMenu {
  readonly el: HTMLElement;
  private readonly opButtons = new Map<TerraformOpKind, HTMLButtonElement>();
  private readonly brushBtn: HTMLButtonElement;
  private readonly overlayBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(
    parent: HTMLElement,
    private readonly brush: BrushController,
    private readonly overlay: TileOverlay,
    private readonly opts: TerraformMenuOptions = {},
  ) {
    this.el = makeDiv('ta-tf-menu plate', 'terraform-menu');
    const header = makeDiv('ta-tf-menu__header');
    header.appendChild(makeSpan('eyebrow', undefined, 'TERRAFORM OPS'));

    const opsRow = makeDiv('ta-tf-menu__ops');
    for (const def of OP_DEFS) {
      const btn = makeBtn('btn btn-sm btn-ghost', def.testid, def.label, () => this.toggleOp(def.op));
      btn.dataset.op = def.op;
      this.opButtons.set(def.op, btn);
      opsRow.appendChild(btn);
    }

    this.brushBtn = makeBtn('btn btn-sm btn-ghost', 'tf-brush-mode', '', () => {
      this.brush.setBrushMode(this.brush.getBrushMode() === 'single' ? 'area' : 'single');
      this.render();
    });
    this.overlayBtn = makeBtn('btn btn-sm btn-ghost', 'tf-overlay-toggle', '', () => {
      this.overlay.setVisible();
      this.render();
    });
    this.cancelBtn = makeBtn('btn btn-sm btn-danger', 'tf-cancel', 'CANCEL', () => {
      this.brush.cancelOrder(this.overlay.getActiveOrder()?.orderId);
      this.render();
    });
    const controlsRow = makeDiv('ta-tf-menu__controls');
    controlsRow.append(this.brushBtn, this.overlayBtn, this.cancelBtn);

    this.statusEl = makeDiv('ta-tf-menu__status', 'tf-status');
    this.el.append(header, opsRow, controlsRow, this.statusEl);
    parent.appendChild(this.el);

    this.onKey = (e) => this.handleKey(e);
    // Capture phase: Esc that disarms the brush must not also reach the session's pause handler (bubble phase).
    window.addEventListener('keydown', this.onKey, { capture: true });
    this.render();
  }

  /** Clicking the armed op again disarms the brush. */
  private toggleOp(op: TerraformOpKind): void {
    if (this.brush.isArmed() && this.brush.getSelectedOp() === op) this.brush.disarm();
    else this.brush.selectOp(op);
    this.render();
  }

  private handleKey(e: KeyboardEvent): void {
    if (!isHotkeyPress(e) || this.opts.isBlocked?.()) return;
    const k = (e.key ?? '').toLowerCase();
    if (k === 'escape') {
      if (!this.brush.isArmed()) return;
      e.stopImmediatePropagation();
      this.brush.disarm();
    } else if (k === 'v') {
      this.overlay.setVisible();
    } else {
      const def = OP_DEFS.find((d) => d.key === k);
      if (!def) return;
      this.brush.selectOp(def.op);
    }
    this.render();
  }

  render(): void {
    const selectedOp = this.brush.getSelectedOp();
    const armed = this.brush.isArmed();
    for (const [op, btn] of this.opButtons) {
      const isSelected = armed && selectedOp === op;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.className = isSelected ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost';
    }

    const mode = this.brush.getBrushMode();
    this.brushBtn.dataset.mode = mode;
    this.brushBtn.textContent = mode === 'single' ? 'BRUSH: SINGLE (1×1)' : 'BRUSH: AREA (BOX)';

    const overlayOn = this.overlay.isVisible();
    this.overlayBtn.setAttribute('aria-pressed', String(overlayOn));
    this.overlayBtn.className = overlayOn ? 'btn btn-sm btn-system' : 'btn btn-sm btn-ghost';
    this.overlayBtn.textContent = overlayOn ? 'OVERLAY: ON [V]' : 'OVERLAY: OFF [V]';

    const active = this.overlay.getActiveOrder();
    this.cancelBtn.disabled = !active;
    this.el.dataset.armed = String(armed);

    const parts: string[] = [];
    const stroke = this.brush.getLastStroke();
    if (stroke) parts.push(stroke.tooLarge ? `Area too large: ${stroke.tiles.length} tiles, nothing sent` : `Queued ${stroke.queuedCount} jobs · ${stroke.skippedCount} skipped`);
    if (active) {
      const cur = active.currentJob;
      const curStr = cur ? `${cur.op.toUpperCase()} ${cur.percent}%` : `${active.overallPercent}%`;
      parts.push(`${active.completedJobs} / ${active.totalJobs} jobs · ${curStr}`);
    } else if (!stroke) {
      parts.push(armed ? `Tool: ${selectedOp.toUpperCase()} · ${mode.toUpperCase()}` : 'Pick an op to paint the map');
    }
    this.statusEl.textContent = parts.join(' | ');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.el.remove();
  }
}
