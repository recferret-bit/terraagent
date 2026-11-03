import type { GoalKind, GoalParams, QueueGoalArgs } from '@terra/contracts';
import { GOAL_CATALOG } from '@terra/sim';

export interface GoalFormOptions {
  onAdd: (args: QueueGoalArgs) => void;
  disabled?: boolean;
}

export class GoalForm {
  readonly el: HTMLElement;
  readonly kindSelect: HTMLSelectElement;
  private readonly paramsBox: HTMLElement;
  readonly budgetInput: HTMLInputElement;
  private readonly budgetVal: HTMLElement;
  readonly addBtn: HTMLButtonElement;
  private readonly onAdd: (args: QueueGoalArgs) => void;

  constructor(opts: GoalFormOptions) {
    this.onAdd = opts.onAdd;
    this.el = document.createElement('form');
    this.el.className = 'ta-goal-form';
    this.el.onsubmit = (e) => {
      e.preventDefault();
      this.submit();
    };

    const kindRow = document.createElement('div');
    kindRow.className = 'ta-goal-form__row';

    const kindLabel = document.createElement('label');
    kindLabel.className = 'ta-goal-form__label';
    kindLabel.textContent = 'GOAL';

    this.kindSelect = document.createElement('select');
    this.kindSelect.className = 'ta-goal-form__select';
    this.kindSelect.setAttribute('data-testid', 'goal-kind-select');

    for (const [key, entry] of Object.entries(GOAL_CATALOG)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = entry.label;
      this.kindSelect.appendChild(opt);
    }
    this.kindSelect.value = 'establish_colony';
    this.kindSelect.onchange = () => this.renderParams();

    kindRow.append(kindLabel, this.kindSelect);

    this.paramsBox = document.createElement('div');
    this.paramsBox.className = 'ta-goal-form__params';

    const budgetRow = document.createElement('div');
    budgetRow.className = 'ta-goal-form__row ta-goal-form__row--budget';

    const budgetLabel = document.createElement('label');
    budgetLabel.className = 'ta-goal-form__label';
    budgetLabel.textContent = 'BUDGET';

    this.budgetInput = document.createElement('input');
    this.budgetInput.type = 'range';
    this.budgetInput.className = 'ta-goal-form__budget-range';
    this.budgetInput.setAttribute('data-testid', 'goal-param-budget');
    this.budgetInput.min = '0';
    this.budgetInput.max = '100';
    this.budgetInput.value = '50';
    this.budgetInput.step = '5';

    this.budgetVal = document.createElement('span');
    this.budgetVal.className = 'ta-goal-form__budget-val';
    this.budgetVal.setAttribute('data-testid', 'goal-param-budget-val');
    this.budgetVal.textContent = '50%';

    this.budgetInput.oninput = () => {
      this.budgetVal.textContent = `${this.budgetInput.value}%`;
    };

    budgetRow.append(budgetLabel, this.budgetInput, this.budgetVal);

    this.addBtn = document.createElement('button');
    this.addBtn.type = 'button';
    this.addBtn.className = 'ta-goal-form__add-btn';
    this.addBtn.setAttribute('data-testid', 'goal-add-btn');
    this.addBtn.textContent = 'ADD GOAL';
    this.addBtn.disabled = opts.disabled ?? false;
    this.addBtn.onclick = () => this.submit();

    this.el.append(kindRow, this.paramsBox, budgetRow, this.addBtn);
    this.renderParams();
  }

  setDisabled(disabled: boolean): void {
    this.addBtn.disabled = disabled;
  }

  renderParams(): void {
    this.paramsBox.innerHTML = '';
    const kind = this.kindSelect.value as GoalKind;

    if (kind === 'grow_economy') {
      const resRow = document.createElement('div');
      resRow.className = 'ta-goal-form__row';

      const resLabel = document.createElement('label');
      resLabel.className = 'ta-goal-form__label';
      resLabel.textContent = 'RESOURCE';

      const resSelect = document.createElement('select');
      resSelect.className = 'ta-goal-form__select';
      resSelect.setAttribute('data-testid', 'goal-param-resource');

      const resources = [
        { value: 'metals.t1', label: 'Metals' },
        { value: 'minerals.t1', label: 'Minerals' },
        { value: 'bio.water', label: 'Water' },
        { value: 'bio.biomass', label: 'Biomass' },
      ];
      for (const r of resources) {
        const opt = document.createElement('option');
        opt.value = r.value;
        opt.textContent = r.label;
        resSelect.appendChild(opt);
      }

      resRow.append(resLabel, resSelect);

      const rateRow = document.createElement('div');
      rateRow.className = 'ta-goal-form__row';

      const rateLabel = document.createElement('label');
      rateLabel.className = 'ta-goal-form__label';
      rateLabel.textContent = 'RATE/MIN';

      const rateInput = document.createElement('input');
      rateInput.type = 'number';
      rateInput.className = 'ta-goal-form__input';
      rateInput.setAttribute('data-testid', 'goal-param-rate');
      rateInput.value = '10';
      rateInput.min = '1';
      rateInput.max = '100000';

      rateRow.append(rateLabel, rateInput);
      this.paramsBox.append(resRow, rateRow);
    } else if (kind === 'secure_power') {
      const energyRow = document.createElement('div');
      energyRow.className = 'ta-goal-form__row';

      const energyLabel = document.createElement('label');
      energyLabel.className = 'ta-goal-form__label';
      energyLabel.textContent = 'NET E/S (NIGHT)';

      const energyInput = document.createElement('input');
      energyInput.type = 'number';
      energyInput.className = 'ta-goal-form__input';
      energyInput.setAttribute('data-testid', 'goal-param-energy');
      energyInput.value = '10';
      energyInput.min = '0';
      energyInput.max = '100000';

      energyRow.append(energyLabel, energyInput);
      this.paramsBox.append(energyRow);
    }
  }

  submit(): void {
    if (this.addBtn.disabled) return;
    const kind = this.kindSelect.value as GoalKind;
    const budgetPct = Number(this.budgetInput.value) || 50;
    const budgetBp = Math.round(budgetPct * 100);

    const params: GoalParams = {};
    if (kind === 'grow_economy') {
      const resSelect = this.paramsBox.querySelector<HTMLSelectElement>('[data-testid="goal-param-resource"]');
      const rateInput = this.paramsBox.querySelector<HTMLInputElement>('[data-testid="goal-param-rate"]');
      if (resSelect) params.resource = resSelect.value;
      if (rateInput) params.targetRatePerMin = Number(rateInput.value) || 10;
    } else if (kind === 'secure_power') {
      const energyInput = this.paramsBox.querySelector<HTMLInputElement>('[data-testid="goal-param-energy"]');
      if (energyInput) params.targetNetEnergyPerS = Number(energyInput.value) || 10;
    }

    this.onAdd({
      goal: kind,
      params,
      budgetBp,
    });
  }
}
