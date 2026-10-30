import type { HqStatusView, LandfallController } from './selection';

function clampPct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/**
 * Faction Plate HQ status panel (`data-testid="hq-panel"`).
 * Displays unit title, HP bar & text, Power Cell bar & text, current job, and queue count.
 */
export class HqPanel {
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly selectBtn: HTMLButtonElement;
  private readonly hpText: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly cellText: HTMLElement;
  private readonly cellFill: HTMLElement;
  private readonly jobText: HTMLElement;
  private readonly queueText: HTMLElement;
  private readonly offChange: () => void;

  constructor(parent: HTMLElement, private readonly controller: LandfallController) {
    this.el = document.createElement('div');
    this.el.className = 'plate ta-hq-panel';
    this.el.dataset.testid = 'hq-panel';
    this.el.dataset.selected = 'false';
    this.el.hidden = true;

    const head = document.createElement('div');
    head.className = 'ta-hq-panel__head';

    this.titleEl = document.createElement('h3');
    this.titleEl.className = 'ta-hq-panel__title';
    this.titleEl.dataset.testid = 'hq-title';
    this.titleEl.textContent = 'HQ T1 · COMMANDER DRONE';

    this.selectBtn = document.createElement('button');
    this.selectBtn.type = 'button';
    this.selectBtn.className = 'ta-hq-panel__badge plate-sm';
    this.selectBtn.dataset.testid = 'hq-select-btn';
    this.selectBtn.textContent = 'SELECT HQ';
    this.selectBtn.onclick = () => {
      this.controller.toggleSelectHq();
    };
    head.append(this.titleEl, this.selectBtn);

    const hpStat = document.createElement('div');
    hpStat.className = 'ta-hq-panel__stat';
    const hpRow = document.createElement('div');
    hpRow.className = 'ta-hq-panel__row';
    const hpKey = document.createElement('span');
    hpKey.className = 'ta-hq-panel__key';
    hpKey.textContent = 'HULL HP';
    this.hpText = document.createElement('span');
    this.hpText.className = 'ta-hq-panel__val';
    this.hpText.dataset.testid = 'hq-hp';
    this.hpText.textContent = '900 / 900';
    hpRow.append(hpKey, this.hpText);
    const hpBar = document.createElement('div');
    hpBar.className = 'ta-hq-panel__bar';
    this.hpFill = document.createElement('div');
    this.hpFill.className = 'ta-hq-panel__fill ta-hq-panel__fill--hp';
    this.hpFill.dataset.testid = 'hq-hp-bar';
    hpBar.appendChild(this.hpFill);
    hpStat.append(hpRow, hpBar);

    const cellStat = document.createElement('div');
    cellStat.className = 'ta-hq-panel__stat';
    const cellRow = document.createElement('div');
    cellRow.className = 'ta-hq-panel__row';
    const cellKey = document.createElement('span');
    cellKey.className = 'ta-hq-panel__key';
    cellKey.textContent = 'POWER CELL';
    this.cellText = document.createElement('span');
    this.cellText.className = 'ta-hq-panel__val';
    this.cellText.dataset.testid = 'hq-cell';
    this.cellText.textContent = '800 / 800 E';
    cellRow.append(cellKey, this.cellText);
    const cellBar = document.createElement('div');
    cellBar.className = 'ta-hq-panel__bar';
    this.cellFill = document.createElement('div');
    this.cellFill.className = 'ta-hq-panel__fill ta-hq-panel__fill--cell';
    this.cellFill.dataset.testid = 'hq-cell-bar';
    cellBar.appendChild(this.cellFill);
    cellStat.append(cellRow, cellBar);

    const footer = document.createElement('div');
    footer.className = 'ta-hq-panel__footer';
    this.jobText = document.createElement('span');
    this.jobText.className = 'ta-hq-panel__job';
    this.jobText.dataset.testid = 'hq-job';
    this.jobText.textContent = 'idle';
    this.queueText = document.createElement('span');
    this.queueText.className = 'ta-hq-panel__queue';
    this.queueText.dataset.testid = 'hq-queue';
    this.queueText.textContent = 'Queue: 0';
    footer.append(this.jobText, this.queueText);

    this.el.append(head, hpStat, cellStat, footer);
    parent.appendChild(this.el);

    this.offChange = this.controller.onChange(({ hq, selectedEntityId }) => {
      this.render(hq, selectedEntityId !== null && hq !== null && selectedEntityId === hq.entityId);
    });
  }

  render(hq: HqStatusView | null, selected: boolean): void {
    if (!hq) {
      this.el.hidden = true;
      this.el.dataset.selected = 'false';
      return;
    }
    this.el.hidden = false;
    this.el.dataset.selected = String(selected);
    this.selectBtn.textContent = selected ? 'SELECTED' : 'SELECT HQ';
    this.titleEl.textContent = `HQ T${hq.tier} · COMMANDER DRONE`;
    this.hpText.textContent = `${Math.round(hq.hp)} / ${Math.round(hq.hpMax)}`;
    this.hpFill.style.width = `${clampPct(hq.hp, hq.hpMax).toFixed(1)}%`;
    this.cellText.textContent = `${Math.round(hq.cell)} / ${Math.round(hq.cellMax)} E`;
    this.cellFill.style.width = `${clampPct(hq.cell, hq.cellMax).toFixed(1)}%`;
    this.jobText.textContent = hq.currentJob;
    this.queueText.textContent = `Queue: ${hq.queueCount}`;
  }

  dispose(): void {
    this.offChange();
    this.el.remove();
  }
}
