import { ENTITY_STATE } from '@terra/sim';
import { SelectionDetails } from '../shared/SelectionDetails';
import { createProgressBar, setProgress } from '../shared/progress';
import { depositResource } from '../shared/depositLabel';
import type { HqStatusView, LandfallController, SelectedDepositView, SelectedEntityView } from './selection';
import { baseHqSelectedView } from './selectionHelpers';

function buildStatBlock(labelText: string, valTestId: string, valInit: string, fillTestId: string, fillModifier: string): {
  stat: HTMLElement;
  keyEl: HTMLElement;
  valEl: HTMLElement;
  fillEl: HTMLElement;
} {
  const stat = document.createElement('div');
  stat.className = 'ta-hq-panel__stat';
  const row = document.createElement('div');
  row.className = 'ta-hq-panel__row';
  const keyEl = document.createElement('span');
  keyEl.className = 'ta-hq-panel__key';
  keyEl.textContent = labelText;
  const valEl = document.createElement('span');
  valEl.className = 'ta-hq-panel__val';
  valEl.dataset.testid = valTestId;
  valEl.textContent = valInit;
  row.append(keyEl, valEl);
  const { bar, fill: fillEl } = createProgressBar(labelText, 'ta-hq-panel__bar', `ta-hq-panel__fill ${fillModifier}`, fillTestId);
  stat.append(row, bar);
  return { stat, keyEl, valEl, fillEl };
}

const hqFallbackEntity = baseHqSelectedView;

function isEntityBusy(entity: SelectedEntityView, prog: number): boolean {
  const job = entity.currentJob;
  const st = entity.state;
  return (
    job === 'working' ||
    job === 'moving' ||
    job === 'constructing' ||
    job === 'harvesting' ||
    job === 'repairing' ||
    st === ENTITY_STATE.working ||
    st === ENTITY_STATE.moving ||
    st === ENTITY_STATE.constructing ||
    st === ENTITY_STATE.harvesting ||
    st === ENTITY_STATE.repairing ||
    (prog > 0 && prog < 1) ||
    entity.queueCount > 0 ||
    entity.terraformJob === true
  );
}
function depositMeta(deposit: number, tier: number): { code: string; name: string } {
  const code = deposit === 1 ? 'FE' : deposit === 2 ? 'SI' : 'CH';
  const res = depositResource(deposit, tier);
  return { code, name: res ? `${res.label.toUpperCase()} DEPOSIT · T${res.tier}` : 'DEPOSIT' };
}

/**
 * Optional combat-squad summary supplied by the `army` feature when 1+ combat units are selected,
 * allowing combat orders to dock inline inside the single `HqPanel` bar instead of opening a second panel.
 */
export interface SelectionCombatSummary {
  count: number;
  code?: string;
  title?: string;
  hp?: number;
  hpMax?: number;
}

export interface SelectionCombatHost {
  readonly slotEl: HTMLElement;
  setCombatSelection(summary: SelectionCombatSummary | null): void;
}

/**
 * Faction Plate Selected Unit / Building / Deposit bottom-centered horizontal bar (`data-testid="hq-panel"`).
 */
function buildPanelFooter(onCancel: () => void): {
  footer: HTMLElement;
  jobText: HTMLElement;
  queueText: HTMLElement;
  tierText: HTMLElement;
  cancelBtn: HTMLButtonElement;
} {
  const footer = document.createElement('div');
  footer.className = 'ta-hq-panel__footer';
  const jobText = document.createElement('span');
  jobText.className = 'ta-hq-panel__job';
  jobText.dataset.testid = 'hq-job';
  jobText.textContent = 'idle';
  jobText.title = 'Right-click a tile: move · X: stop';
  const queueText = document.createElement('span');
  queueText.className = 'ta-hq-panel__queue';
  queueText.dataset.testid = 'hq-queue';
  queueText.textContent = 'Queue: 0';
  const tierText = document.createElement('span');
  tierText.className = 'ta-hq-panel__queue';
  tierText.dataset.testid = 'hq-extractor-tier';
  tierText.hidden = true;
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ta-hq-panel__cancel btn-sm';
  cancelBtn.dataset.testid = 'hq-panel-cancel';
  cancelBtn.textContent = 'CANCEL JOB';
  cancelBtn.title = "Cancel this unit's current job (X stops movement only)";
  cancelBtn.hidden = true;
  cancelBtn.onclick = onCancel;
  footer.append(jobText, queueText, tierText, cancelBtn);
  return { footer, jobText, queueText, tierText, cancelBtn };
}

export class HqPanel implements SelectionCombatHost {
  readonly el: HTMLElement;
  readonly slotEl: HTMLElement;
  readonly details: SelectionDetails;
  private readonly codeBadgeEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly entityIdEl: HTMLElement;
  private readonly selectBtn: HTMLButtonElement;
  private readonly hpKey: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly cellStat: HTMLElement;
  private readonly cellText: HTMLElement;
  private readonly cellFill: HTMLElement;
  private readonly progressStat: HTMLElement;
  private readonly progressText: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly jobText: HTMLElement;
  private readonly queueText: HTMLElement;
  private readonly tierText: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;
  private combatSummary: SelectionCombatSummary | null = null;
  private lastSnap: {
    hq: HqStatusView | null;
    isEntitySelected: boolean;
    selectedEntity: SelectedEntityView | null;
    selectedDeposit: SelectedDepositView | null;
  } = { hq: null, isEntitySelected: false, selectedEntity: null, selectedDeposit: null };
  private readonly offChange: () => void;

  constructor(parent: HTMLElement, private readonly controller: LandfallController) {
    this.el = document.createElement('div');
    this.el.className = 'plate ta-hq-panel';
    this.el.dataset.testid = 'hq-panel';
    this.el.dataset.selected = 'false';
    this.el.hidden = true;

    const grid = document.createElement('div');
    grid.className = 'ta-hq-panel__grid';
    grid.dataset.testid = 'selection-grid';
    this.codeBadgeEl = document.createElement('span');
    this.codeBadgeEl.className = 'ta-hq-panel__slot';
    this.codeBadgeEl.dataset.testid = 'selection-slot';
    this.codeBadgeEl.textContent = 'HQ';
    this.countEl = document.createElement('span');
    this.countEl.className = 'ta-hq-panel__count';
    this.countEl.dataset.testid = 'selection-count';
    this.countEl.textContent = '1';
    this.countEl.title = 'Selected count';
    grid.append(this.codeBadgeEl, this.countEl);

    const head = document.createElement('div');
    head.className = 'ta-hq-panel__head';

    this.titleEl = document.createElement('h3');
    this.titleEl.className = 'ta-hq-panel__title';
    this.titleEl.dataset.testid = 'hq-title';
    this.titleEl.textContent = 'HQ T1 · COMMANDER DRONE';

    this.entityIdEl = document.createElement('span');
    this.entityIdEl.className = 'ta-hq-panel__id';
    this.entityIdEl.dataset.testid = 'selection-entity-id';
    this.entityIdEl.hidden = true;

    this.selectBtn = document.createElement('button');
    this.selectBtn.type = 'button';
    this.selectBtn.className = 'ta-hq-panel__badge plate-sm';
    this.selectBtn.dataset.testid = 'hq-select-btn';
    this.selectBtn.textContent = 'SELECT HQ';
    this.selectBtn.setAttribute('aria-pressed', 'false');
    this.selectBtn.onclick = () => this.controller.toggleSelectHq();
    head.append(this.titleEl, this.entityIdEl, this.selectBtn);

    const hp = buildStatBlock('HULL HP', 'hq-hp', '— / —', 'hq-hp-bar', 'ta-hq-panel__fill--hp');
    this.hpKey = hp.keyEl;
    this.hpText = hp.valEl;
    this.hpFill = hp.fillEl;

    const cell = buildStatBlock('POWER CELL', 'hq-cell', '— / — E', 'hq-cell-bar', 'ta-hq-panel__fill--cell');
    this.cellStat = cell.stat;
    this.cellText = cell.valEl;
    this.cellFill = cell.fillEl;

    const prog = buildStatBlock('PROGRESS', 'hq-progress', '0%', 'hq-progress-bar', 'ta-hq-panel__fill--progress');
    this.progressStat = prog.stat;
    this.progressStat.hidden = true;
    this.progressText = prog.valEl;
    this.progressFill = prog.fillEl;

    const ft = buildPanelFooter(() => this.controller.cancelSelected());
    this.jobText = ft.jobText;
    this.queueText = ft.queueText;
    this.tierText = ft.tierText;
    this.cancelBtn = ft.cancelBtn;

    this.slotEl = document.createElement('div');
    this.slotEl.className = 'ta-hq-panel__combat-slot';
    this.slotEl.dataset.testid = 'hq-panel-combat-slot';
    this.slotEl.hidden = true;

    this.el.append(grid, head, hp.stat, this.cellStat, this.progressStat, ft.footer, this.slotEl);
    this.details = new SelectionDetails(this.el);
    parent.appendChild(this.el);

    this.offChange = this.controller.onChange(({ hq, selectedEntityId, selectedEntity, selectedDeposit }) => {
      const isEntitySelected = selectedEntityId !== null && (selectedEntity !== null || hq !== null);
      this.lastSnap = { hq, isEntitySelected, selectedEntity, selectedDeposit };
      this.render(hq, isEntitySelected, selectedEntity, selectedDeposit);
    });
  }

  setCombatSelection(summary: SelectionCombatSummary | null): void {
    this.combatSummary = summary && summary.count > 0 ? summary : null;
    this.slotEl.hidden = this.combatSummary === null;
    const { hq, isEntitySelected, selectedEntity, selectedDeposit } = this.lastSnap;
    this.render(hq, isEntitySelected, selectedEntity, selectedDeposit);
  }

  private renderDeposit(deposit: SelectedDepositView): void {
    const meta = depositMeta(deposit.deposit, deposit.tier);
    const stageLabel = deposit.stage.toUpperCase();
    this.el.dataset.selected = 'true';
    this.el.dataset.depositStage = deposit.stage;
    this.selectBtn.textContent = 'SELECTED';
    this.selectBtn.setAttribute('aria-pressed', 'true');
    this.el.hidden = false;

    this.codeBadgeEl.textContent = meta.code;
    this.countEl.hidden = true; // the stage is the footer status (one place, like a unit's job)
    this.titleEl.textContent = meta.name;
    this.entityIdEl.hidden = true;
    delete this.el.dataset.entityId;

    this.hpKey.textContent = 'RESERVES';
    this.hpText.textContent = `${Math.round(deposit.remaining)} / ${deposit.maxUnits}`;
    setProgress(this.hpFill, deposit.remaining, deposit.maxUnits);

    this.cellStat.hidden = true;
    this.progressStat.hidden = true;
    this.cancelBtn.hidden = true;
    this.tierText.hidden = true;
    this.slotEl.hidden = true;
    this.queueText.hidden = false;

    this.jobText.textContent = stageLabel;
    this.queueText.textContent = `(${deposit.q}, ${deposit.r})`;
  }

  render(
    hq: HqStatusView | null,
    selected: boolean,
    selectedEntity?: SelectedEntityView | null,
    selectedDeposit?: SelectedDepositView | null,
  ): void {
    const deposit = selectedDeposit ?? (selected ? null : this.controller.getSelectedDeposit?.() ?? null);
    if (!selected && deposit) {
      this.renderDeposit(deposit);
      return;
    }

    delete this.el.dataset.depositStage;
    const entity: SelectedEntityView | null = selectedEntity ?? (hq ? hqFallbackEntity(hq) : null);

    this.el.dataset.selected = String(selected);
    this.selectBtn.textContent = selected ? 'SELECTED' : 'SELECT HQ';
    this.selectBtn.setAttribute('aria-pressed', String(selected));

    if (!selected || !entity) {
      this.el.hidden = true;
      this.cancelBtn.hidden = true;
      this.progressStat.hidden = true;
      this.entityIdEl.hidden = true;
      this.slotEl.hidden = true;
      delete this.el.dataset.entityId;
      return;
    }

    const combat = this.combatSummary;
    const isMultiCombat = Boolean(combat && combat.count > 1);
    const hasCombatControls = Boolean(combat && combat.count > 0);

    this.el.hidden = false;
    this.el.dataset.entityId = String(entity.entityId);
    this.entityIdEl.hidden = isMultiCombat;
    this.entityIdEl.textContent = `#${entity.entityId}`;
    this.codeBadgeEl.textContent = isMultiCombat && combat?.code ? combat.code : entity.shortCode;
    this.countEl.hidden = false;
    this.countEl.textContent = String(hasCombatControls ? combat!.count : 1);
    this.titleEl.textContent = isMultiCombat && combat?.title ? combat.title : entity.kindLabel;
    this.hpKey.textContent = 'HULL HP';
    const hpVal = isMultiCombat && typeof combat?.hp === 'number' ? combat.hp : entity.hp;
    const hpMaxVal = isMultiCombat && typeof combat?.hpMax === 'number' ? combat.hpMax : entity.hpMax;
    this.hpText.textContent = `${Math.round(hpVal)} / ${Math.round(hpMaxVal)}`;
    setProgress(this.hpFill, hpVal, hpMaxVal);

    if (typeof entity.cell === 'number' && typeof entity.cellMax === 'number' && entity.cellMax > 0) {
      this.cellStat.hidden = false;
      this.cellText.textContent = `${Math.round(entity.cell)} / ${Math.round(entity.cellMax)} E`;
      setProgress(this.cellFill, entity.cell, entity.cellMax);
    } else {
      this.cellStat.hidden = true;
    }

    const prog = entity.progress ?? 0;
    if (prog > 0 && prog < 1) {
      this.progressStat.hidden = false;
      this.progressText.textContent = `${Math.round(prog * 100)}%`;
      setProgress(this.progressFill, prog, 1);
    } else {
      this.progressStat.hidden = true;
      this.progressFill.style.width = '0.0%';
    }

    this.jobText.textContent = entity.currentJob;
    this.queueText.textContent = `Queue: ${entity.queueCount}`;
    this.queueText.hidden = hasCombatControls;
    this.slotEl.hidden = !hasCombatControls;
    if (entity.extractorTier) {
      this.tierText.hidden = false;
      this.tierText.textContent = entity.extractorTier.summaryText;
      this.tierText.dataset.unlockedTier = String(entity.extractorTier.unlockedTier);
      this.tierText.dataset.ringPct = String(entity.extractorTier.ringTerraformedPct);
    } else {
      this.tierText.hidden = true;
      this.tierText.textContent = '';
      delete this.tierText.dataset.unlockedTier;
      delete this.tierText.dataset.ringPct;
    }
    const isSpec = Boolean((this.controller as { isSpectator?: () => boolean }).isSpectator?.());
    this.cancelBtn.hidden = isSpec || hasCombatControls || !isEntityBusy(entity, prog);
  }

  dispose(): void {
    this.offChange();
    this.el.remove();
  }
}
