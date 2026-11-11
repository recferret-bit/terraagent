import type { AutoTradePartner } from '@terra/contracts';
import { T1_RESOURCE_KEYS } from '@terra/contracts';
import { fieldRow } from './dom';
import { T1_TRADE_LABEL } from './autotrade';

const PARTNER_LABEL: Record<AutoTradePartner, string> = {
  guild: 'Guild',
  truce: 'Truce',
  anyone: 'Anyone',
};

export interface AutoTradeDom {
  root: HTMLElement;
  resource: HTMLSelectElement;
  sell: HTMLInputElement;
  maxTrade: HTMLInputElement;
  maxSession: HTMLInputElement;
  minStock: HTMLInputElement;
  partners: HTMLSelectElement;
  save: HTMLButtonElement;
  tradeStatus: HTMLElement;
  toggle: HTMLButtonElement;
  keyStatus: HTMLElement;
  revoke: HTMLButtonElement;
}

/** Tier-1 editor plus the director-key switch. Callers skip this when W15 is off. */
export function buildAutoTradeDom(parent: HTMLElement, partners: readonly AutoTradePartner[]): AutoTradeDom {
  const root = document.createElement('section');
  root.className = 'ta-away__autotrade';
  root.dataset.testid = 'away-autotrade';
  root.setAttribute('aria-label', 'Auto trade');
  const kicker = document.createElement('div');
  kicker.className = 'ta-away__kicker';
  kicker.textContent = 'AUTOTRADE';
  const resource = resourceSelect();
  const sell = numInput('away-autotrade-sell', 'Sell above storage percent');
  const maxTrade = numInput('away-autotrade-max-trade', 'Max per trade');
  const maxSession = numInput('away-autotrade-max-session', 'Max per session');
  const minStock = numInput('away-autotrade-min-stock', 'Minimum stock');
  const partnerSelect = partnerSelectEl(partners);
  const save = actionButton('away-autotrade-save', 'SAVE LIMITS');
  const tradeStatus = statusLine('away-autotrade-status');
  const director = directorRow();
  root.append(
    kicker,
    fieldRow('Resource', resource),
    fieldRow('Sell above %', sell),
    fieldRow('Max per trade', maxTrade),
    fieldRow('Max per session', maxSession),
    fieldRow('Keep at least', minStock),
    fieldRow('Partners', partnerSelect),
    save,
    tradeStatus,
    director.row,
  );
  parent.append(root);
  return {
    root,
    resource,
    sell,
    maxTrade,
    maxSession,
    minStock,
    partners: partnerSelect,
    save,
    tradeStatus,
    ...director.controls,
  };
}

function resourceSelect(): HTMLSelectElement {
  const select = document.createElement('select');
  select.dataset.testid = 'away-autotrade-resource';
  select.setAttribute('aria-label', 'Auto trade resource');
  for (const key of T1_RESOURCE_KEYS) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = T1_TRADE_LABEL[key];
    select.append(option);
  }
  return select;
}

function partnerSelectEl(partners: readonly AutoTradePartner[]): HTMLSelectElement {
  const select = document.createElement('select');
  select.dataset.testid = 'away-autotrade-partners';
  select.setAttribute('aria-label', 'Auto trade partners');
  for (const value of partners) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = PARTNER_LABEL[value];
    select.append(option);
  }
  return select;
}

function numInput(testid: string, label: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = '1';
  input.className = 'ta-away__num';
  input.dataset.testid = testid;
  input.setAttribute('aria-label', label);
  input.inputMode = 'numeric';
  return input;
}

function actionButton(testid: string, text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-sm ta-away__save';
  button.dataset.testid = testid;
  button.textContent = text;
  return button;
}

function statusLine(testid: string): HTMLElement {
  const status = document.createElement('div');
  status.className = 'ta-away__status';
  status.dataset.testid = testid;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  return status;
}

function directorRow(): { row: HTMLElement; controls: Pick<AutoTradeDom, 'toggle' | 'keyStatus' | 'revoke'> } {
  const row = document.createElement('div');
  row.className = 'ta-away__director';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'switch';
  toggle.dataset.testid = 'away-director-toggle';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', 'false');
  toggle.setAttribute('aria-label', 'Enable director key');
  const knob = document.createElement('span');
  knob.className = 'switch-knob';
  const switchText = document.createElement('span');
  switchText.className = 'switch-text';
  toggle.append(knob, switchText);
  const label = document.createElement('span');
  label.className = 'ta-away__key-label';
  label.textContent = 'Director key';
  const keyStatus = statusLine('away-director-status');
  const revoke = actionButton('away-director-revoke', 'REVOKE');
  revoke.classList.add('ta-away__revoke');
  revoke.hidden = true;
  revoke.disabled = true;
  row.append(toggle, label, keyStatus, revoke);
  return { row, controls: { toggle, keyStatus, revoke } };
}
