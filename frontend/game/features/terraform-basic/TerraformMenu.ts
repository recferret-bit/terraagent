import {
  DISMANTLE_REFUND_RATE,
  formatUnlockAtTooltip,
  getItemUnlockStage,
  REPAIR_COST_RATE,
  type CompiledDataLike,
  type TerraformOpKind,
} from '@terra/sim';
import { isDockPaneShown } from '../../core/hud/CommandDock';
import type { GameView } from '../../core/registry/types';
import { makeBtn, makeDiv, makeSpan } from '../shared/dom';
import { isHotkeyPress } from '../shared/hotkeys';
import type { BrushController, TerraformButtonOp, TerraformPrimaryOp } from './BrushController';
import { pct, ReferenceTables } from './referenceTables';
import type { TileOverlay } from './TileOverlay';
import {
  createBrushBarDom,
  renderW05MenuOpChips,
  syncBrushBarDom,
  type BrushBarRefs,
  type BrushShape,
} from './w05MenuOps';
import { colonyWorkJobs, workStatusText } from './workStatus';

export interface TerraformStageOpDef {
  readonly id: 'fill' | 'bridge';
  readonly label: string;
  readonly subtitle: string;
  readonly testid: string;
  readonly unlockStage: number;
}

export const STAGE_TERRAFORM_OP_DEFS: readonly TerraformStageOpDef[] = [
  { id: 'fill', label: 'FILL', subtitle: 'Fill hole · Prepared ground', testid: 'tf-op-fill', unlockStage: getItemUnlockStage('fill') || 2 },
  { id: 'bridge', label: 'BRIDGE', subtitle: 'Bridge water · Prepared ground', testid: 'tf-op-bridge', unlockStage: getItemUnlockStage('bridge') || 2 },
];

function resolveTerraformUnlockStage(view: GameView | null | undefined, colonyId = 0): number | undefined {
  if (!view) return undefined;
  const v = view as {
    colonyId?: number;
    colonyIndex?: number;
    unlockStage?: number;
    stage?: number;
    colonies?: Array<{ index?: number; unlockStage?: number; stage?: number }>;
  };
  const idx = v.colonyIndex ?? v.colonyId ?? colonyId;
  const col = v.colonies?.find((c) => c?.index === idx) ?? v.colonies?.[idx] ?? v.colonies?.[0];
  const val = col?.unlockStage ?? col?.stage ?? v.unlockStage ?? v.stage;
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function formatTerraformUnlockDetail(stage: number): string {
  if (stage === 2) {
    return 'Unlocks at S2: extractor + generator complete · 2 min';
  }
  return formatUnlockAtTooltip(stage);
}

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
 * The dock buttons, top to bottom. `F` is the camera's follow-HQ key, so TERRAFORM takes `G` (the old Grade key).
 * `R` is the construction ghost's rotate key while a ghost is up (the brush hotkeys are blocked then). `X` stays the
 * selected unit's stop key only (`app/online/unitControl`; owner decision W02), so DISMANTLE takes `Z`.
 */
export const PRIMARY_OP_DEFS: readonly TerraformPrimaryOpDef[] = [
  { op: 'terraform', label: 'TERRAFORM [G]', subtitle: 'Flatten ground · continuous', key: 'g', testid: 'tf-op-terraform' },
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
  /** The host's compiled balance data (`WorldStore.simData`) the reference tables read. */
  simData?: () => CompiledDataLike | null | undefined;
  /** The client flags: ops of a wave that is off (`?waves=..01`: REPAIR, DISMANTLE) are not offered. Absent: all on. */
  flags?: ReadonlySet<string>;
}

export class TerraformMenu {
  readonly el: HTMLElement;
  private readonly opButtons = new Map<TerraformButtonOp, HTMLButtonElement>();
  private w05OpButtons = new Map<TerraformOpKind, HTMLButtonElement>();
  private readonly stageOpsRow: HTMLElement;
  private readonly w05OpsRow: HTMLElement;
  private readonly brushBar: BrushBarRefs | null;
  private readonly workerBadge: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly tables: ReferenceTables;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly w05Enabled: boolean;
  /** The newest stroke whose work showed up in the view (so its end can be reported). */
  private workSeenFor: string | null = null;
  private lastStageKey: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly brush: BrushController,
    private readonly overlay: TileOverlay,
    private readonly opts: TerraformMenuOptions = {},
  ) {
    this.w05Enabled = !this.opts.flags || this.opts.flags.has('W05');
    this.el = makeDiv('ta-tf-menu plate', 'terraform-menu');
    const header = makeDiv('ta-tf-menu__header');
    header.appendChild(makeSpan('eyebrow', undefined, 'TERRAFORM OPS'));
    this.workerBadge = makeSpan(
      'ta-tf-menu__workers mono',
      'tf-worker-badge',
      this.w05Enabled ? 'HQ, Builder & Terraformer' : 'HQ Drone & Harvester',
    );
    header.appendChild(this.workerBadge);

    const opsRow = makeDiv('ta-tf-menu__ops');
    for (const def of PRIMARY_OP_DEFS) {
      if (def.wave && this.opts.flags && !this.opts.flags.has(def.wave)) continue;
      const btn = makeBtn('btn btn-sm btn-ghost ta-tf-menu__op-btn', def.testid, '', () => this.toggleOp(def.op));
      btn.dataset.op = def.op;
      const titleSpan = makeSpan('ta-tf-menu__op-title', undefined, def.label);
      const descSpan = makeSpan('ta-tf-menu__op-desc', undefined, def.subtitle);
      btn.append(titleSpan, descSpan);
      this.opButtons.set(def.op, btn);
      opsRow.appendChild(btn);
    }

    this.stageOpsRow = makeDiv('ta-tf-menu__stage-ops', 'tf-stage-ops');
    this.stageOpsRow.hidden = true;

    this.brushBar = this.w05Enabled
      ? createBrushBarDom(
          (shape: BrushShape) => {
            this.brush.setBrushShape(shape);
            this.render();
          },
          () => {
            this.brush.cancelArea();
            this.brush.setCancelMode(!this.brush.isCancelMode());
            this.render();
          },
        )
      : null;

    this.w05OpsRow = makeDiv('ta-tf-menu__w05-ops', 'tf-w05-ops');
    this.w05OpsRow.hidden = !this.w05Enabled;

    this.statusEl = makeDiv('ta-tf-menu__status', 'tf-status');

    this.tables = new ReferenceTables(() => this.opts.simData?.());
    if (this.brushBar) {
      this.el.append(header, opsRow, this.brushBar.root, this.stageOpsRow, this.w05OpsRow, this.statusEl, this.tables.el);
    } else {
      this.el.append(header, opsRow, this.stageOpsRow, this.w05OpsRow, this.statusEl, this.tables.el);
    }
    parent.appendChild(this.el);

    this.onKey = (e) => this.handleKey(e);
    // Capture phase: Esc that disarms the brush must not also reach the session's pause handler (bubble phase).
    window.addEventListener('keydown', this.onKey, { capture: true });
    this.render();
  }

  /** Clicking the armed op again disarms the brush. */
  private toggleOp(op: TerraformButtonOp): void {
    if (this.brush.isArmed() && !this.brush.isCancelMode() && this.brush.getSelectedOp() === op) this.brush.disarm();
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
    const armed = this.brush.isArmed() && !this.brush.isCancelMode();
    for (const [op, btn] of this.opButtons) {
      const isSelected = armed && selectedOp === op;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.className = isSelected
        ? 'btn btn-sm btn-primary ta-tf-menu__op-btn'
        : 'btn btn-sm btn-ghost ta-tf-menu__op-btn';
    }

    const workersReady = this.brush.hasWorkerAvailable();
    this.workerBadge.dataset.available = String(workersReady);

    this.el.dataset.armed = String(this.brush.isArmed());
    this.renderStageOps();
    if (this.w05Enabled) {
      const view = this.brush.getView();
      const planetType = (view as { planet?: { type?: string } } | null)?.planet?.type;
      this.w05OpButtons = renderW05MenuOpChips({
        container: this.w05OpsRow,
        data: this.opts.simData?.() ?? undefined,
        planetType,
        maxWorkerTier: this.brush.getMaxWorkerTier(view),
        selectedOp,
        armed,
        omitOps: this.stageOpsRow.hidden ? undefined : new Set(['fill']),
        onSelectOp: (op) => this.toggleOp(op),
      });
      if (this.brushBar) {
        syncBrushBarDom(this.brushBar, this.brush.getBrushShape(), this.brush.isCancelMode());
      }
    }
    this.tables.refresh();
    this.statusEl.textContent = this.statusText(this.brush.isArmed(), selectedOp);
  }

  private renderStageOps(): void {
    const view = this.brush.getView();
    const isLiveGameView = Boolean(view && typeof view === 'object' && 'planet' in view && (view as { planet?: unknown }).planet !== undefined);
    const w08Off = Boolean(this.opts.flags && !this.opts.flags.has('W08') && isLiveGameView);
    const colonyStage = w08Off ? undefined : resolveTerraformUnlockStage(view, this.opts.getColonyId?.() ?? 0);
    const stageKey = colonyStage === undefined ? 'none' : String(colonyStage);
    if (this.lastStageKey === stageKey) return;
    this.lastStageKey = stageKey;

    this.stageOpsRow.replaceChildren();
    if (colonyStage === undefined) {
      this.stageOpsRow.hidden = true;
      return;
    }

    const visibleDefs = STAGE_TERRAFORM_OP_DEFS.filter((d) => d.unlockStage <= colonyStage + 1);
    if (visibleDefs.length === 0) {
      this.stageOpsRow.hidden = true;
      return;
    }

    this.stageOpsRow.hidden = false;
    for (const def of visibleDefs) {
      const stageLocked = colonyStage < def.unlockStage;
      const cls = stageLocked
        ? 'btn btn-sm btn-ghost ta-tf-menu__op-btn ta-tf-menu__stage-op is-stage-locked'
        : 'btn btn-sm btn-ghost ta-tf-menu__op-btn ta-tf-menu__stage-op';
      const btn = makeBtn(cls, def.testid, '', () => {});
      btn.setAttribute('data-stage-op', def.id);
      btn.setAttribute('data-terraform-op', def.id);
      btn.setAttribute('data-order', def.id);
      btn.setAttribute('data-unlock-stage', String(def.unlockStage));
      btn.setAttribute('data-disabled', String(stageLocked));
      btn.disabled = stageLocked;

      const titleSpan = makeSpan('ta-tf-menu__op-title', undefined, def.label);
      const descSpan = makeSpan('ta-tf-menu__op-desc', undefined, def.subtitle);
      btn.append(titleSpan, descSpan);

      if (stageLocked) {
        const cond = formatUnlockAtTooltip(def.unlockStage);
        const detail = formatTerraformUnlockDetail(def.unlockStage);
        const fullTooltip = detail !== cond ? `${cond} (${detail})` : cond;
        btn.setAttribute('data-stage-locked', 'true');
        btn.setAttribute('title', fullTooltip);
        btn.setAttribute('aria-label', `${def.label} — ${fullTooltip}`);
        btn.setAttribute('data-unlock-detail', detail);
        const reasonSpan = makeSpan('ta-tf-menu__reason', undefined, cond);
        btn.appendChild(reasonSpan);
        if (detail !== cond) {
          const detailSpan = makeSpan('ta-tf-menu__unlock-detail', undefined, detail);
          btn.appendChild(detailSpan);
        }
      }

      this.stageOpsRow.appendChild(btn);
    }
  }

  /**
   * The status line: a refused click or a host reject first, then the colony's running `work` jobs (the TERRAFORM
   * chain hex by hex, repairs), then an S0 order's progress, then the last order, then a hint.
   */
  private statusText(armed: boolean, selectedOp: TerraformButtonOp): string {
    const stroke = this.brush.getLastStroke();
    const failed = stroke?.outcome?.ok === false || (stroke !== null && stroke.queuedCount === 0);
    const jobs = colonyWorkJobs(this.brush.getView(), this.opts.getColonyId?.() ?? 0);
    if (stroke && jobs.length > 0) this.workSeenFor = stroke.strokeId;
    const work = workStatusText(jobs);
    const active = this.overlay.getActiveOrder();
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
    if (stroke && this.workSeenFor === stroke.strokeId && (stroke.op === 'terraform' || stroke.op === 'repair')) {
      return stroke.op === 'terraform' ? 'Terraform chain ended: no reachable obstacle left, or the worker was stopped' : 'Repair done';
    }
    if (stroke) return stroke.statusText ?? `Queued ${stroke.queuedCount} jobs · ${stroke.skippedCount} skipped`;
    if (this.brush.isCancelMode()) return 'Tool: CANCEL AREA · click or drag hexes';
    return armed ? `Tool: ${selectedOp.toUpperCase()} · click a hex` : 'Pick an op, then click a hex';
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.el.remove();
  }
}
