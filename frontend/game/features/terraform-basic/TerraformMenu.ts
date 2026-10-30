import type { TerraformOpKind } from '@terra/sim';
import type { BrushController } from './BrushController';
import { ensureDom } from './dom';
import type { TileOverlay } from './TileOverlay';

const OP_DEFS: ReadonlyArray<{ op: TerraformOpKind; label: string; key: string; testid: string }> = [
  { op: 'grade', label: 'GRADE [G]', key: 'g', testid: 'tf-op-grade' },
  { op: 'clear', label: 'CLEAR [C]', key: 'c', testid: 'tf-op-clear' },
  { op: 'break', label: 'BREAK [B]', key: 'b', testid: 'tf-op-break' },
];

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
  ) {
    ensureDom();
    this.el = document.createElement('div');
    this.el.className = 'ta-tf-menu plate';
    this.el.dataset.testid = 'terraform-menu';

    const header = document.createElement('div');
    header.className = 'ta-tf-menu__header';
    const title = document.createElement('span');
    title.className = 'eyebrow';
    title.textContent = 'TERRAFORM OPS';
    header.appendChild(title);

    const opsRow = document.createElement('div');
    opsRow.className = 'ta-tf-menu__ops';
    for (const def of OP_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-ghost';
      btn.dataset.testid = def.testid;
      btn.dataset.op = def.op;
      btn.textContent = def.label;
      btn.onclick = () => {
        this.brush.selectOp(def.op);
        this.render();
      };
      this.opButtons.set(def.op, btn);
      opsRow.appendChild(btn);
    }

    const controlsRow = document.createElement('div');
    controlsRow.className = 'ta-tf-menu__controls';

    this.brushBtn = document.createElement('button');
    this.brushBtn.type = 'button';
    this.brushBtn.className = 'btn btn-sm btn-ghost';
    this.brushBtn.dataset.testid = 'tf-brush-mode';
    this.brushBtn.onclick = () => {
      const next = this.brush.getBrushMode() === 'single' ? 'area' : 'single';
      this.brush.setBrushMode(next);
      this.render();
    };

    this.overlayBtn = document.createElement('button');
    this.overlayBtn.type = 'button';
    this.overlayBtn.className = 'btn btn-sm btn-ghost';
    this.overlayBtn.dataset.testid = 'tf-overlay-toggle';
    this.overlayBtn.onclick = () => {
      this.overlay.setVisible();
      this.render();
    };

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.className = 'btn btn-sm btn-danger';
    this.cancelBtn.dataset.testid = 'tf-cancel';
    this.cancelBtn.textContent = 'CANCEL';
    this.cancelBtn.onclick = () => {
      const activeId = this.overlay.getState().activeOrder?.orderId;
      this.brush.cancelOrder(activeId);
      this.render();
    };

    controlsRow.append(this.brushBtn, this.overlayBtn, this.cancelBtn);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'ta-tf-menu__status';
    this.statusEl.dataset.testid = 'tf-status';

    this.el.append(header, opsRow, controlsRow, this.statusEl);
    parent.appendChild(this.el);

    this.onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const k = (e.key ?? '').toLowerCase();
      if (k === 'g') { this.brush.selectOp('grade'); this.render(); }
      else if (k === 'c') { this.brush.selectOp('clear'); this.render(); }
      else if (k === 'b') { this.brush.selectOp('break'); this.render(); }
      else if (k === 'v' || k === 'o') { this.overlay.setVisible(); this.render(); }
    };
    window.addEventListener('keydown', this.onKey);
    this.render();
  }

  render(): void {
    const selectedOp = this.brush.getSelectedOp();
    for (const [op, btn] of this.opButtons) {
      const isSelected = selectedOp === op;
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

    const overlayState = this.overlay.getState();
    const active = overlayState.activeOrder;
    this.cancelBtn.disabled = !active && !this.brush.getLastStroke();

    const parts: string[] = [];
    const stroke = this.brush.getLastStroke();
    if (stroke) {
      parts.push(`Queued ${stroke.queuedCount} jobs · ${stroke.skippedCount} skipped`);
    }
    if (active) {
      const cur = active.currentJob;
      const curStr = cur ? `${cur.op.toUpperCase()} ${cur.percent}%` : `${active.overallPercent}%`;
      parts.push(`${active.completedJobs} / ${active.totalJobs} jobs · ${curStr}`);
    } else if (!stroke) {
      parts.push(`Tool: ${String(selectedOp).toUpperCase()} · ${mode.toUpperCase()}`);
    }
    this.statusEl.textContent = parts.join(' | ');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}
