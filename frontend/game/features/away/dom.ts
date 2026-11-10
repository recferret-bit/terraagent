import { AWAY_FAMILIES, AWAY_FAMILY_LABEL, AWAY_DIRECTIVE_PCT, type AwayFamily } from './model';

/** Shown only while W22 is on. The words are the switch label. */
export const MERCENARY_SWITCH_LABEL = 'Hire mercenaries when attacked while away';

export interface AwayDom {
  toggle: HTMLButtonElement;
  caret: HTMLElement;
  body: HTMLElement;
  mode: HTMLSelectElement;
  raids: HTMLInputElement;
  /** Null when W22 is off, so the plate does not offer a hire. */
  mercenaries: HTMLInputElement | null;
  maxSpend: HTMLInputElement | null;
  sessions: Record<AwayFamily, HTMLInputElement>;
  readouts: Record<AwayFamily, HTMLElement>;
  save: HTMLButtonElement;
  status: HTMLElement;
}

/** Builds the plate. No `innerHTML`: labels and reject text are untrusted-safe text nodes. */
export function buildAwayDom(host: HTMLElement, opts: { mercenary?: boolean } = {}): AwayDom {
  host.classList.add('ta-away', 'plate-sm');
  const { toggle, caret } = titleButton();
  const body = document.createElement('div');
  body.className = 'ta-away__body';
  body.dataset.testid = 'away-panel';
  const mode = modeSelect();
  const raids = raidsBox();
  const sessions = {} as Record<AwayFamily, HTMLInputElement>;
  const readouts = {} as Record<AwayFamily, HTMLElement>;
  body.append(fieldRow('Mode', mode), fieldRow('Away raids', raids), directiveLine());
  const mercenary = opts.mercenary ? mercenaryFields() : null;
  if (mercenary) body.append(mercenary.row, mercenary.maxRow);
  for (const family of AWAY_FAMILIES) {
    const row = sessionRow(family);
    sessions[family] = row.input;
    readouts[family] = row.readout;
    body.append(row.el);
  }
  const save = saveButton();
  const status = statusLine();
  body.append(save, status);
  host.append(toggle, body);
  return {
    toggle, caret, body, mode, raids,
    mercenaries: mercenary?.box ?? null,
    maxSpend: mercenary?.max ?? null,
    sessions, readouts, save, status,
  };
}

function titleButton(): { toggle: HTMLButtonElement; caret: HTMLElement } {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ta-away__toggle';
  toggle.dataset.testid = 'away-toggle';
  const title = document.createElement('span');
  title.textContent = 'AWAY';
  const caret = document.createElement('span');
  caret.className = 'ta-away__caret';
  caret.textContent = '▾';
  toggle.append(title, caret);
  return { toggle, caret };
}

function modeSelect(): HTMLSelectElement {
  const select = document.createElement('select');
  select.dataset.testid = 'away-mode';
  select.setAttribute('aria-label', 'Autopilot mode');
  for (const [value, label] of [['director', 'Director'], ['rules_only', 'Rules only']] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  return select;
}

function raidsBox(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'ta-away__check';
  input.dataset.testid = 'away-raids';
  input.setAttribute('aria-label', 'Away raids');
  return input;
}

function mercenaryFields(): { row: HTMLElement; maxRow: HTMLElement; box: HTMLInputElement; max: HTMLInputElement } {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'ta-away__check';
  box.dataset.testid = 'away-mercenaries';
  box.setAttribute('aria-label', MERCENARY_SWITCH_LABEL);
  const row = fieldRow(MERCENARY_SWITCH_LABEL, box);
  row.classList.add('ta-away__merc');
  const max = document.createElement('input');
  max.type = 'text';
  max.inputMode = 'numeric';
  max.className = 'ta-away__spend';
  max.dataset.testid = 'away-mercenary-max';
  max.setAttribute('aria-label', 'Mercenary max spend');
  max.autocomplete = 'off';
  max.spellcheck = false;
  const maxRow = fieldRow('Max spend', max);
  return { row, maxRow, box, max };
}

function saveButton(): HTMLButtonElement {
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary btn-sm ta-away__save';
  save.dataset.testid = 'away-save';
  save.textContent = 'SAVE';
  return save;
}

function statusLine(): HTMLElement {
  const status = document.createElement('div');
  status.className = 'ta-away__status';
  status.dataset.testid = 'away-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  return status;
}

function directiveLine(): HTMLElement {
  const line = document.createElement('div');
  line.className = 'ta-away__directive';
  line.dataset.testid = 'away-directive';
  line.textContent = `directive ${AWAY_DIRECTIVE_PCT}%`;
  return line;
}

function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('label');
  row.className = 'ta-away__row';
  const text = document.createElement('span');
  text.textContent = label;
  row.append(text, control);
  return row;
}

function sessionRow(family: AwayFamily): { el: HTMLElement; input: HTMLInputElement; readout: HTMLElement } {
  const el = document.createElement('label');
  el.className = 'ta-away__family';
  const name = document.createElement('span');
  name.textContent = AWAY_FAMILY_LABEL[family];
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.dataset.testid = `away-session-${family}`;
  input.setAttribute('aria-label', `${AWAY_FAMILY_LABEL[family]} session percent`);
  const readout = document.createElement('span');
  readout.className = 'ta-away__pct';
  readout.dataset.testid = `away-session-${family}-value`;
  el.append(name, input, readout);
  return { el, input, readout };
}
