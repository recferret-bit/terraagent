import { DISMANTLE_REFUND_RATE, REPAIR_COST_RATE } from '@terra/sim';
import { isDockPaneShown } from '../../core/hud/CommandDock';
import { makeBtn, makeDiv, makeSpan } from '../shared/dom';
import { isHotkeyPress } from '../shared/hotkeys';
import type { BrushController, TerraformPrimaryOp } from './BrushController';
import { pct } from './planner';
import type { TileOverlay } from './TileOverlay';
import { colonyWorkJobs, workStatusText } from './workStatus';

export interface TerraformPrimaryOpDef {
  readonly op: TerraformPrimaryOp;
  readonly label: string;
  readonly subtitle: string;
  /** `KeyboardEvent.key`, lower case. */
  readonly key: string;
  readonly testid: string;
  /** The wave that brings the op (absent: the feature's own wave); without it the button and its hotkey are absent. */
  readonly wave?: string;
}

/**
 * The dock buttons, top to bottom: the whole Terraform menu. `F` is the camera's follow-HQ key, so TERRAFORM takes `G`
 * (the old Grade key). `R` is the construction ghost's rotate key while a ghost is up (the brush hotkeys are blocked
 * then). `X` stays the selected unit's stop key only (`app/online/unitControl`; owner decision W02), so DISMANTLE
 * takes `Z`. TERRAFORM does every ground job (trees, rock, slopes, craters, water): the host picks each hex's op.
 */
export const PRIMARY_OP_DEFS: readonly TerraformPrimaryOpDef[] = [
  { op: 'terraform', label: 'TERRAFORM [G]', subtitle: 'All ground work · Ctrl+click queues', key: 'g', testid: 'tf-op-terraform' },
  { op: 'cultivate', label: 'CULTIVATE [V]', subtitle: 'Grade → Irrigate → Seed (Living)', key: 'v', testid: 'tf-op-cultivate', wave: 'W05' },
  { op: 'repair', label: 'REPAIR [R]', subtitle: `${pct(REPAIR_COST_RATE)} of base cost`, key: 'r', testid: 'tf-op-repair', wave: 'W02' },
  { op: 'dismantle', label: 'DISMANTLE [Z]', subtitle: `½ build time · ${pct(DISMANTLE_REFUND_RATE)} of cost back`, key: 'z', testid: 'tf-op-dismantle', wave: 'W02' },
];

const HOTKEY_OP_MAP: Readonly<Record<string, TerraformPrimaryOp>> = Object.fromEntries(
  PRIMARY_OP_DEFS.map((d) => [d.key, d.op]),
);

export interface TerraformMenuOptions {
  /** Another map mode owns input (a Hub / construction ghost): the brush hotkeys stay quiet. */
  isBlocked?: () => boolean;
  /** The player's colony (whose work jobs the status line shows). */
  getColonyId?: () => number;
  /** The client flags: ops of a wave that is off (`?waves=..01`: REPAIR, DISMANTLE) are not offered. Absent: all on. */
  flags?: ReadonlySet<string>;
}

export class TerraformMenu {
  readonly el: HTMLElement;
  private readonly opButtons = new Map<TerraformPrimaryOp, HTMLButtonElement>();
  private readonly workerBadge: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly onKey: (e: KeyboardEvent) => void;
  /** The newest stroke whose work showed up in the view (so its end can be reported). */
  private workSeenFor: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly brush: BrushController,
    private readonly overlay: TileOverlay,
    private readonly opts: TerraformMenuOptions = {},
  ) {
    this.el = makeDiv('ta-tf-menu plate', 'terraform-menu');
    const header = makeDiv('ta-tf-menu__header');
    header.appendChild(makeSpan('eyebrow', undefined, 'TERRAFORM OPS'));
    this.workerBadge = makeSpan('ta-tf-menu__workers mono', 'tf-worker-badge', 'Worker Drones');
    header.appendChild(this.workerBadge);

    const opsRow = makeDiv('ta-tf-menu__ops');
    for (const def of PRIMARY_OP_DEFS) {
      if (def.wave && this.opts.flags && !this.opts.flags.has(def.wave)) continue;
      const btn = makeBtn('btn btn-sm btn-ghost ta-tf-menu__op-btn', def.testid, '', () => this.toggleOp(def.op));
      btn.dataset.op = def.op;
      btn.append(makeSpan('ta-tf-menu__op-title', undefined, def.label), makeSpan('ta-tf-menu__op-desc', undefined, def.subtitle));
      this.opButtons.set(def.op, btn);
      opsRow.appendChild(btn);
    }

    this.statusEl = makeDiv('ta-tf-menu__status', 'tf-status');
    this.el.append(header, opsRow, this.statusEl);
    parent.appendChild(this.el);

    this.onKey = (e) => this.handleKey(e);
    // Capture phase: Esc that disarms the brush must not also reach the session's pause handler (bubble phase).
    window.addEventListener('keydown', this.onKey, { capture: true });
    this.render();
  }

  /** Clicking the armed op again disarms the brush. */
  private toggleOp(op: TerraformPrimaryOp): void {
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
    } else {
      const op = HOTKEY_OP_MAP[k];
      // Only while the Terraform tab is open: an armed tool must be visible (G / R / Z do nothing on a hidden tab).
      if (!op || !this.opButtons.has(op) || !isDockPaneShown(this.el)) return;
      this.brush.selectOp(op);
    }
    this.render();
  }

  render(): void {
    // The tab was closed or switched while a tool was armed: an invisible tool must not take map clicks.
    if (this.brush.isArmed() && !isDockPaneShown(this.el)) {
      this.brush.disarm(); // re-renders through the brush's onChange
      if (!this.brush.isArmed()) return this.renderState();
    }
    this.renderState();
  }

  private renderState(): void {
    const selectedOp = this.brush.getSelectedOp();
    const armed = this.brush.isArmed();
    for (const [op, btn] of this.opButtons) {
      const isSelected = armed && selectedOp === op;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.className = isSelected ? 'btn btn-sm btn-primary ta-tf-menu__op-btn' : 'btn btn-sm btn-ghost ta-tf-menu__op-btn';
    }
    this.workerBadge.dataset.available = String(this.brush.hasWorkerAvailable());
    this.el.dataset.armed = String(armed);
    this.statusEl.textContent = this.statusText(armed, selectedOp);
  }

  /**
   * The status line: a refused click or a host reject first, then the colony's running `work` jobs (repairs), then a
   * terraform order's progress, then the last order, then a hint.
   */
  private statusText(armed: boolean, selectedOp: TerraformPrimaryOp): string {
    const stroke = this.brush.getLastStroke();
    const failed = stroke?.outcome?.ok === false || (stroke !== null && stroke.queuedCount === 0);
    const jobs = colonyWorkJobs(this.brush.getView(), this.opts.getColonyId?.() ?? 0);
    if (stroke && jobs.length > 0) this.workSeenFor = stroke.strokeId;
    const work = workStatusText(jobs);
    const active = this.overlay.getActiveOrder();
    if (stroke && active) this.workSeenFor = stroke.strokeId;
    if (stroke && failed) {
      const refused = stroke.statusText ?? `Nothing to do here · ${stroke.skippedCount} skipped`;
      return work ? `${refused} | ${work}` : refused;
    }
    if (work) return work;
    if (active) {
      const cur = active.currentJob;
      const curStr = cur ? `${cur.op.toUpperCase()} ${cur.percent}%` : `${active.overallPercent}%`;
      const waitSuffix = active.waitingText ? ` · ${active.waitingText}` : '';
      return `${active.completedJobs} / ${active.totalJobs} jobs · ${curStr}${waitSuffix}`;
    }
    if (stroke && this.workSeenFor === stroke.strokeId && (stroke.op === 'terraform' || stroke.op === 'cultivate' || stroke.op === 'repair')) {
      return stroke.op === 'terraform' ? 'Terraform done' : stroke.op === 'cultivate' ? 'Cultivate done' : 'Repair done';
    }
    if (stroke) return stroke.statusText ?? `Queued ${stroke.queuedCount} jobs · ${stroke.skippedCount} skipped`;
    return armed ? `Tool: ${selectedOp.toUpperCase()} · click a hex (Ctrl+click: queue more)` : 'Pick an op, then click a hex';
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.el.remove();
  }
}
