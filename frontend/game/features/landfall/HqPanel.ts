import { ENTITY_STATE } from '@terra/sim';
import { SelectionDetails } from '../shared/SelectionDetails';
import { createProgressBar, setProgress } from '../shared/progress';
import { depositResource } from '../shared/depositLabel';
import type { HqStatusView, LandfallController, SelectedDepositView, SelectedEntityView } from './selection';

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

function hqFallbackEntity(hq: HqStatusView): SelectedEntityView {
  return {
    entityId: hq.entityId,
    kind: 1,
    kindLabel: `HQ T${hq.tier} · COMMANDER DRONE`,
    shortCode: 'HQ',
    isUnit: true,
    isMovable: true,
    tier: hq.tier,
    q: hq.q,
    r: hq.r,
    x: hq.x,
    y: hq.y,
    hp: hq.hp,
    hpMax: hq.hpMax,
    cell: hq.cell,
    cellMax: hq.cellMax,
    currentJob: hq.currentJob,
    queueCount: hq.queueCount,
  };
}

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
 * Faction Plate Selected Unit / Building / Deposit bottom-centered horizontal bar (`data-testid="hq-panel"`).
 */
export class HqPanel {
  readonly el: HTMLElement;
  readonly details: SelectionDetails;
  private readonly slotEl: HTMLElement;
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
  private readonly cancelBtn: HTMLButtonElement;
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
    this.slotEl = document.createElement('span');
    this.slotEl.className = 'ta-hq-panel__slot';
    this.slotEl.dataset.testid = 'selection-slot';
    this.slotEl.textContent = 'HQ';
    this.countEl = document.createElement('span');
    this.countEl.className = 'ta-hq-panel__count';
    this.countEl.dataset.testid = 'selection-count';
    this.countEl.textContent = '1';
    this.countEl.title = 'Selected count';
    grid.append(this.slotEl, this.countEl);

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

    const footer = document.createElement('div');
    footer.className = 'ta-hq-panel__footer';
    this.jobText = document.createElement('span');
    this.jobText.className = 'ta-hq-panel__job';
    this.jobText.dataset.testid = 'hq-job';
    this.jobText.textContent = 'idle';
    this.jobText.title = 'Right-click a tile: move · X: stop';
    this.queueText = document.createElement('span');
    this.queueText.className = 'ta-hq-panel__queue';
    this.queueText.dataset.testid = 'hq-queue';
    this.queueText.textContent = 'Queue: 0';

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.className = 'ta-hq-panel__cancel btn-sm';
    this.cancelBtn.dataset.testid = 'hq-panel-cancel';
    this.cancelBtn.textContent = 'CANCEL JOB';
    this.cancelBtn.title = 'Cancel this unit\'s current job (X stops movement only)';
    this.cancelBtn.hidden = true;
    this.cancelBtn.onclick = () => {
      this.controller.cancelSelected();
    };
    footer.append(this.jobText, this.queueText, this.cancelBtn);

    this.el.append(grid, head, hp.stat, this.cellStat, this.progressStat, footer);
    this.details = new SelectionDetails(this.el);
    parent.appendChild(this.el);

    this.offChange = this.controller.onChange(({ hq, selectedEntityId, selectedEntity, selectedDeposit }) => {
      const isEntitySelected = selectedEntityId !== null && (selectedEntity !== null || hq !== null);
      this.render(hq, isEntitySelected, selectedEntity, selectedDeposit);
    });
  }

  private renderDeposit(deposit: SelectedDepositView): void {
    const meta = depositMeta(deposit.deposit, deposit.tier);
    const stageLabel = deposit.stage.toUpperCase();
    this.el.dataset.selected = 'true';
    this.el.dataset.depositStage = deposit.stage;
    this.selectBtn.textContent = 'SELECTED';
    this.selectBtn.setAttribute('aria-pressed', 'true');
    this.el.hidden = false;

    this.slotEl.textContent = meta.code;
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
      delete this.el.dataset.entityId;
      return;
    }

    this.el.hidden = false;
    this.el.dataset.entityId = String(entity.entityId);
    this.entityIdEl.hidden = false;
    this.entityIdEl.textContent = `#${entity.entityId}`;
    this.slotEl.textContent = entity.shortCode;
    this.countEl.hidden = false;
    this.countEl.textContent = '1';
    this.titleEl.textContent = entity.kindLabel;
    this.hpKey.textContent = 'HULL HP';
    this.hpText.textContent = `${Math.round(entity.hp)} / ${Math.round(entity.hpMax)}`;
    setProgress(this.hpFill, entity.hp, entity.hpMax);

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
    this.cancelBtn.hidden = !isEntityBusy(entity, prog);
  }

  dispose(): void {
    this.offChange();
    this.el.remove();
  }
}
