import { DEV_TOKENS, type TokenKind, type TokenStore } from './api';
import { badge, button, el, plate, table } from './dom';
import type { DiffRow } from './model';

export interface VersionRow { readonly version: number; readonly status: string; readonly revision: number; readonly contentHash: string }
export interface ProfileRow { readonly id: string; readonly name: string; readonly versions: readonly VersionRow[] }
export interface ActivationRow { readonly id: string; readonly versionId: string; readonly state: string; readonly effectiveTick: number | null; readonly appliedTick: number | null; readonly operator: string; readonly evidenceRunId: string | null }
export interface Layer { readonly scope: string; readonly versionId: string; readonly contentHash: string }

const TONE: Record<string, string> = { DRAFT: 'new', VALIDATED: 'ai', APPROVED: 'ok', ACTIVE: 'ok', PENDING: 'away', SUPERSEDED: 'sealed', FAILED: 'alert' };
export const statusBadge = (s: string) => badge(s, TONE[s] ?? 'sealed');

/** Token entry: three separate credentials (read / edit / activate), kept in sessionStorage, plus a dev-token shortcut. */
export function renderTokens(store: TokenStore, onChange: () => void): HTMLElement {
  const p = plate('Credentials', 'ACCESS · SESSION ONLY');
  const row = el('div', 'xe-tokens');
  for (const kind of ['read', 'edit', 'activate'] as TokenKind[]) {
    const label = el('label', 'xe-tok');
    label.append(el('span', 'eyebrow', kind.toUpperCase()));
    const input = el('input', 'input');
    input.type = 'password';
    input.id = `xe-token-${kind}`;
    input.autocomplete = 'off';
    input.placeholder = `${kind} token`;
    input.value = store.get(kind);
    input.addEventListener('change', () => { store.set(kind, input.value.trim()); onChange(); });
    label.append(input);
    row.append(label);
  }
  const dev = button('USE DEV TOKENS', 'btn-ghost', () => {
    (Object.keys(DEV_TOKENS) as TokenKind[]).forEach((k) => { store.set(k, DEV_TOKENS[k]); const i = row.querySelector<HTMLInputElement>(`#xe-token-${k}`); if (i) i.value = DEV_TOKENS[k]; });
    onChange();
  }, 'xe-dev-tokens');
  p.body.append(row, dev, el('p', 'xfoot', 'AI experiment credentials hold read/edit only; approve, activate and rollback need the separate activate token.'));
  return p.root;
}

/** Profile list with their versions; clicking a version opens it. */
export function renderProfiles(profiles: readonly ProfileRow[], selected: string | null, onSelect: (profileId: string, version: number) => void): HTMLElement {
  const p = plate('Profiles and versions', 'ECONOMY §5');
  for (const pr of profiles) {
    p.body.append(el('h3', 'xe-sub', pr.name));
    for (const v of pr.versions) {
      const id = `${pr.id}@${v.version}`;
      const b = button(`v${v.version}`, `btn-ghost xe-ver${id === selected ? ' is-selected' : ''}`, () => onSelect(pr.id, v.version), `xe-ver-${id}`);
      b.append(' ', statusBadge(v.status));
      p.body.append(b);
    }
  }
  if (profiles.length === 0) p.body.append(el('p', 'xfoot', 'No profiles (run `npm run db:seed`).'));
  return p.root;
}

export function renderDiff(rows: readonly DiffRow[], baseLabel: string, candLabel: string): HTMLElement {
  const p = plate(`Diff ${baseLabel} → ${candLabel}`, 'VS BASELINE');
  p.root.id = 'xe-diff';
  p.body.append(rows.length === 0 ? el('p', 'xfoot', 'No effective difference.') : table(['PATH', 'UNIT', baseLabel, candLabel], rows.map((r) => [r.path, r.unit, r.from, r.to])));
  return p.root;
}

export interface ActivationViewOptions {
  readonly rows: readonly ActivationRow[];
  readonly canActivate: boolean;
  readonly onActivate: (o: { effectiveTick: number; nonProduction: boolean; evidenceRunId: string }) => void;
  readonly onRollback: (id: string) => void;
}

/** Activation history, the Activate form (sandbox flag, effective tick) and Rollback of the ACTIVE row. */
export function renderActivations(o: ActivationViewOptions): HTMLElement {
  const p = plate('Activation and rollback', 'OPERATOR · SEPARATE TOKEN');
  p.root.id = 'xe-activations';
  p.body.append(table(['ID', 'VERSION', 'STATE', 'EFFECTIVE TICK', 'OPERATOR', ''], o.rows.map((r) => [
    r.id, r.versionId, statusBadge(r.state), String(r.effectiveTick ?? ''), r.operator,
    r.state === 'ACTIVE' ? button('ROLLBACK', 'btn-ghost', () => o.onRollback(r.id), `xe-rollback-${r.id}`) : '',
  ])));
  const form = el('div', 'xe-actform');
  const tick = el('input', 'input'); tick.id = 'xe-tick'; tick.value = '0'; tick.setAttribute('aria-label', 'Effective tick');
  const evidence = el('input', 'input'); evidence.id = 'xe-evidence'; evidence.placeholder = 'evidence run id (needed outside the sandbox)'; evidence.setAttribute('aria-label', 'Evidence run id');
  const sandbox = el('input'); sandbox.type = 'checkbox'; sandbox.id = 'xe-sandbox'; sandbox.checked = true;
  const sbLabel = el('label', 'xe-check'); sbLabel.append(sandbox, ' non-production sandbox (no evidence)');
  const go = button('ACTIVATE SELECTED VERSION', 'btn-primary', () => o.onActivate({ effectiveTick: Number(tick.value) || 0, nonProduction: sandbox.checked, evidenceRunId: evidence.value.trim() }), 'xe-activate');
  go.disabled = !o.canActivate;
  form.append(tick, evidence, sbLabel, go);
  p.body.append(form);
  return p.root;
}

export interface ResolveResult { readonly layers: readonly Layer[]; readonly overrides: unknown; readonly dataHash: string; readonly overridesHash: string; readonly marketPolicyHash: string | null }

/** Scope inheritance: global → planet type → planet id (sector comes with W13-50), with the version that supplies each layer. */
export function renderResolve(result: ResolveResult | null, onResolve: (planetType: string, planetId: string) => void): HTMLElement {
  const p = plate('Resolved scope', 'GLOBAL → PLANET TYPE → PLANET → SECTOR');
  const type = el('input', 'input'); type.id = 'xe-planet-type'; type.placeholder = 'planet type (dune)';
  const id = el('input', 'input'); id.id = 'xe-planet-id'; id.placeholder = 'planet id';
  const sector = el('input', 'input'); sector.placeholder = 'sector (W13-50)'; sector.disabled = true;
  p.body.append(el('div', 'xe-actform'), type, id, sector, button('RESOLVE', 'btn-ghost', () => onResolve(type.value.trim(), id.value.trim()), 'xe-resolve'));
  if (result) {
    p.body.append(table(['SCOPE', 'VERSION', 'CONTENT HASH'], result.layers.map((l) => [l.scope, l.versionId, l.contentHash])));
    p.body.append(el('p', 'xfoot', `dataHash ${result.dataHash} · overridesHash ${result.overridesHash} · market policy ${result.marketPolicyHash ?? 'n/a'}`));
    const pre = el('pre', 'xpayload', JSON.stringify(result.overrides, null, 2));
    pre.id = 'xe-resolved-overrides';
    p.body.append(pre);
  }
  return p.root;
}

export function renderPlaceholders(experiments: { available: boolean; rows: readonly { id: string; status: string }[] }, recipes: readonly { recipeId: string; activityKind: string; enabledWave: string }[]): HTMLElement {
  const root = el('div', 'xe-groups');
  const rec = plate('Recipes', 'READ-ONLY · PATCH EDITS PARAMETERS');
  rec.body.append(recipes.length ? table(['RECIPE', 'ACTIVITY', 'WAVE'], recipes.map((r) => [r.recipeId, r.activityKind, r.enabledWave])) : el('p', 'xfoot', 'This version has no recipes (W13-43 adds the first ones).'));
  const reg = plate('Region and logistics', 'W13-50');
  reg.body.append(el('p', 'xfoot', 'Region and logistics fields appear here when W13-50 lands.'));
  const exp = plate('Experiments', 'W13-44 · W13-45');
  exp.root.id = 'xe-experiments';
  exp.body.append(experiments.available
    ? table(['RUN', 'STATUS'], experiments.rows.map((r) => [r.id, r.status]))
    : el('p', 'xfoot', 'Experiment runner not available yet.'));
  root.append(rec.root, reg.root, exp.root);
  return root;
}
