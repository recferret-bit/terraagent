import { effective, badgesOf, boundsText, formatValue, GROUPS, type ParamField } from './model';
import type { ParamValue } from '@terra/contracts';
import { badge, el, plate } from './dom';

export interface FieldsViewOptions {
  readonly params: Readonly<Record<string, ParamValue>>;
  readonly editable: boolean;
  readonly edits: Record<string, string>;
  readonly errors: Readonly<Record<string, readonly string[]>>;
  readonly filter: string;
  readonly onEdit: () => void;
}

function fieldRow(f: ParamField, o: FieldsViewOptions): HTMLElement {
  const row = el('div', 'xe-field');
  row.dataset.path = f.path;
  const label = el('div', 'xe-label');
  label.append(el('code', 'xe-path', f.path));
  for (const b of badgesOf(f)) label.append(badge(b.label, b.tone));
  label.append(el('p', 'xe-desc', f.prop.description));
  const input = el('input', 'input xe-input');
  input.value = o.edits[f.path] ?? formatValue(effective(f, o.params));
  input.dataset.path = f.path;
  input.disabled = !o.editable || f.prop['x-mutability'] === 'fixed';
  input.setAttribute('aria-label', f.path);
  input.addEventListener('input', () => { o.edits[f.path] = input.value; o.onEdit(); });
  const meta = el('div', 'xe-meta');
  const bounds = boundsText(f);
  meta.append(el('span', '', `unit ${f.prop['x-unit']}`), el('span', '', `default ${formatValue(f.prop.default)}`), ...(bounds ? [el('span', '', `bounds ${bounds}`)] : []));
  if (f.prop['x-why']) meta.append(el('span', '', f.prop['x-why']));
  row.append(label, input, meta);
  for (const m of o.errors[f.path] ?? []) {
    const e = el('p', 'xerr xe-error', m);
    e.setAttribute('role', 'alert');
    row.append(e);
  }
  return row;
}

/** The parameter form generated from the schema, grouped (market / resources / budgets). Disabled when the version is not a DRAFT. */
export function renderFields(fields: readonly ParamField[], o: FieldsViewOptions): HTMLElement {
  const root = el('div', 'xe-groups');
  const q = o.filter.trim().toLowerCase();
  for (const g of GROUPS) {
    const list = fields.filter((f) => f.group === g.id && (q === '' || f.path.toLowerCase().includes(q)));
    if (list.length === 0) continue;
    const p = plate(g.title, `${list.length} FIELDS`);
    for (const f of list) p.body.append(fieldRow(f, o));
    root.append(p.root);
  }
  if (!root.hasChildNodes()) root.append(el('p', 'xfoot', 'No parameter matches the filter.'));
  return root;
}
