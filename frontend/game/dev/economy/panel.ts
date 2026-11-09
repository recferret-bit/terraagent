import type { ParamValue } from '@terra/contracts';
import { EconomyApi, errorsOf, TokenStore, type ApiResult } from './api';
import { button, el, plate } from './dom';
import { buildOps, diffParams, fieldsOf, mapErrors, type EconomySchema, type ParamField } from './model';
import { renderFields } from './view-fields';
import { renderActivations, renderDiff, renderPlaceholders, renderProfiles, renderResolve, renderTokens, statusBadge, type ActivationRow, type ProfileRow, type ResolveResult } from './view-sections';

interface Loaded { readonly ref: { id: string; version: number; hash: string }; readonly version: { id: string; status: string; contentHash: string }; readonly content: { parameters: Record<string, ParamValue>; recipes: { recipeId: string; activityKind: string; enabledWave: string }[] }; readonly revision: number }

/** `/dev/chain/?tab=economy`: operator economy panel (ECONOMY §8). Everything goes through `/v1/economy/*`; no SQL. */
export class EconomyPanel {
  private fields: ParamField[] = [];
  private profiles: ProfileRow[] = [];
  private activations: ActivationRow[] = [];
  private cur: Loaded | null = null;
  private edits: Record<string, string> = {};
  private errors: Record<string, string[]> = {};
  private filter = '';
  private status = '';
  private statusOk = true;
  private diff: { rows: ReturnType<typeof diffParams>; base: string; cand: string } | null = null;
  private resolved: ResolveResult | null = null;
  private experiments = { available: false, rows: [] as { id: string; status: string }[] };
  private readonly api: EconomyApi;
  private readonly tokens = new TokenStore();

  constructor(private readonly root: HTMLElement, fetchImpl?: typeof fetch) {
    this.api = new EconomyApi(this.tokens, fetchImpl);
    void this.reload();
  }

  private say(msg: string, ok = true): void { this.status = msg; this.statusOk = ok; this.render(); }
  private fail(label: string, r: ApiResult): void {
    const errs = errorsOf(r);
    this.errors = mapErrors(errs);
    this.say(`${label}: ${errs.map((e) => `${e.code}${e.path ? ` ${e.path}` : ''} — ${e.message}`).join(' | ')}`, false);
  }

  private async reload(): Promise<void> {
    const s = await this.api.call('GET', '/schema');
    if (s.status !== 200) return this.fail('Schema', s);
    this.fields = fieldsOf(s.json as EconomySchema);
    const [p, a, e] = await Promise.all([this.api.call('GET', '/profiles'), this.api.call('GET', '/activations'), this.api.call('GET', '/experiments')]);
    this.profiles = p.status === 200 ? (p.json.profiles as ProfileRow[]) : [];
    this.activations = a.status === 200 ? (a.json.activations as ActivationRow[]) : [];
    this.experiments = e.status === 200 ? { available: true, rows: (e.json.experiments ?? []) as { id: string; status: string }[] } : { available: false, rows: [] };
    this.status = p.status === 200 ? this.status : '';
    if (p.status !== 200) return this.fail('Profiles', p);
    this.render();
  }

  private async select(profileId: string, version: number): Promise<void> {
    const r = await this.api.call('GET', `/profiles/${profileId}/versions/${version}`);
    if (r.status !== 200) return this.fail('Open version', r);
    this.cur = r.json as Loaded;
    this.edits = {}; this.errors = {}; this.diff = null;
    this.say(`Opened ${this.cur.version.id} (${this.cur.version.status}, revision ${this.cur.revision}).`);
  }

  private async clone(): Promise<void> {
    if (!this.cur) return;
    const { id, version } = this.cur.ref;
    const r = await this.api.call('POST', `/profiles/${id}/versions/${version}/clone`, { requestId: this.api.requestId() }, ['edit']);
    if (r.status !== 201) return this.fail('Clone', r);
    await this.reload();
    await this.select(id, r.json.version.version.version as number);
  }

  private async save(): Promise<void> {
    if (!this.cur) return;
    const built = buildOps(this.fields, this.cur.content.parameters, this.edits);
    if (Object.keys(built.errors).length) { this.errors = Object.fromEntries(Object.entries(built.errors).map(([k, v]) => [k, [v]])); return this.say('Fix the highlighted inputs first.', false); }
    if (built.ops.length === 0) return this.say('Nothing changed.');
    const { id, version } = this.cur.ref;
    const r = await this.api.call('PATCH', `/profiles/${id}/versions/${version}`, { schemaVersion: 1, requestId: this.api.requestId(), expectedVersion: this.cur.revision, ops: built.ops }, ['edit']);
    if (r.status !== 200) { this.fail('Save', r); this.errors = mapErrors(errorsOf(r), built.ops); return this.render(); }
    this.cur = r.json.version as Loaded; this.edits = {}; this.errors = {};
    this.say(`Saved: revision ${this.cur.revision}, ${built.ops.length} change(s).`);
  }

  private async lifecycle(kind: 'validate' | 'approve'): Promise<void> {
    if (!this.cur) return;
    const { id, version } = this.cur.ref;
    const r = await this.api.call('POST', `/profiles/${id}/versions/${version}/${kind}`, { requestId: this.api.requestId() }, [kind === 'approve' ? 'activate' : 'edit']);
    if (r.status !== 200) return this.fail(kind === 'validate' ? 'Validate' : 'Approve', r);
    if (kind === 'validate' && !r.json.valid) { this.errors = mapErrors(r.json.errors); return this.say(`Validation failed: ${(r.json.errors as { code: string; message: string }[]).map((e) => `${e.code} — ${e.message}`).join(' | ')}`, false); }
    await this.reload();
    await this.select(id, version);
    this.say(kind === 'validate' ? `${this.cur?.version.id} is VALIDATED.` : `${this.cur?.version.id} is APPROVED.`);
  }

  private async showDiff(): Promise<void> {
    if (!this.cur) return;
    const base = this.profiles.find((p) => p.id === 'baseline')?.versions[0];
    if (!base) return this.say('No baseline profile to compare with.', false);
    const r = await this.api.call('GET', `/profiles/baseline/versions/${base.version}/export`);
    if (r.status !== 200) return this.fail('Baseline', r);
    this.diff = { rows: diffParams(this.fields, r.json.content.parameters, this.cur.content.parameters), base: `baseline@${base.version}`, cand: this.cur.version.id };
    this.say(`${this.diff.rows.length} parameter(s) differ from ${this.diff.base}.`);
  }

  private async activate(o: { effectiveTick: number; nonProduction: boolean; evidenceRunId: string }): Promise<void> {
    if (!this.cur) return;
    const active = this.activations.find((a) => a.state === 'ACTIVE');
    const r = await this.api.call('POST', '/activations', {
      requestId: this.api.requestId(), versionId: this.cur.version.id, expectedPreviousVersionId: active?.versionId ?? null, effectiveTick: o.effectiveTick,
      ...(o.nonProduction ? { nonProduction: true } : {}), ...(o.evidenceRunId ? { evidenceRunId: o.evidenceRunId } : {}),
    }, ['activate']);
    if (r.status !== 202) return this.fail('Activate', r);
    await this.settle(`Activation of ${this.cur.version.id} scheduled; waiting for the host…`);
  }

  private async rollback(id: string): Promise<void> {
    const r = await this.api.call('POST', `/activations/${id}/rollback`, { requestId: this.api.requestId(), effectiveTick: 0 }, ['activate']);
    if (r.status !== 202) return this.fail('Rollback', r);
    await this.settle('Rollback scheduled; waiting for the host…');
  }

  /** Polls the history until no activation is PENDING (the host applies it within a second or two). */
  private async settle(msg: string): Promise<void> {
    this.say(msg);
    for (let i = 0; i < 40; i++) {
      await this.reload();
      if (!this.activations.some((a) => a.state === 'PENDING')) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    const active = this.activations.find((a) => a.state === 'ACTIVE');
    this.say(`Active version is now ${active?.versionId ?? 'none'}.`);
  }

  private async resolve(planetType: string, planetId: string): Promise<void> {
    const q = new URLSearchParams({ ...(planetType ? { planetType } : {}), ...(planetId ? { planetId } : {}) }).toString();
    const r = await this.api.call('GET', `/resolve${q ? `?${q}` : ''}`);
    if (r.status !== 200) return this.fail('Resolve', r);
    this.resolved = r.json as ResolveResult;
    this.say(`Resolved ${this.resolved.layers.length} layer(s), dataHash ${this.resolved.dataHash}.`);
  }

  private header(): HTMLElement {
    const h = el('header', 'xhead plate');
    const left = el('div');
    left.append(el('p', 'eyebrow', 'DEV TOOLS · ECONOMY §8'), el('h1', 'h2', 'ECONOMY OPERATOR PANEL'));
    h.append(left, el('span', 'badge badge-ai', 'MOCK SANDBOX'));
    return h;
  }

  private editor(): HTMLElement {
    const c = this.cur;
    const p = plate(c ? `${c.version.id} · revision ${c.revision}` : 'Select a version', 'CANDIDATE');
    if (!c) { p.body.append(el('p', 'xfoot', 'Open a version from the list. Approved versions are read-only: clone one to edit.')); return p.root; }
    const draft = c.version.status === 'DRAFT';
    const bar = el('div', 'xe-actform');
    bar.append(statusBadge(c.version.status), button('CLONE AS DRAFT', 'btn-ghost', () => void this.clone(), 'xe-clone'));
    if (draft) bar.append(button('SAVE CHANGES', 'btn-primary', () => void this.save(), 'xe-save'), button('VALIDATE', 'btn-ghost', () => void this.lifecycle('validate'), 'xe-validate'));
    if (c.version.status === 'VALIDATED') bar.append(button('APPROVE', 'btn-primary', () => void this.lifecycle('approve'), 'xe-approve'));
    bar.append(button('DIFF VS BASELINE', 'btn-ghost', () => void this.showDiff(), 'xe-diff-btn'));
    const filter = el('input', 'input'); filter.placeholder = 'filter parameters'; filter.value = this.filter; filter.id = 'xe-filter';
    filter.addEventListener('input', () => { this.filter = filter.value; this.render(); filter.focus(); });
    p.body.append(bar, el('p', 'xfoot', c.version.contentHash), filter);
    return p.root;
  }

  render(): void {
    const keep = document.activeElement instanceof HTMLInputElement ? document.activeElement.dataset.path : undefined;
    const st = el('p', this.statusOk ? 'xfoot xe-status' : 'xerr xe-status', this.status);
    st.id = 'xe-status';
    st.setAttribute('role', 'status');
    const c = this.cur;
    const sections: HTMLElement[] = [this.header(), renderTokens(this.tokens, () => void this.reload()), st,
      renderProfiles(this.profiles, c?.version.id ?? null, (p, v) => void this.select(p, v)), this.editor()];
    if (c) sections.push(renderFields(this.fields, { params: c.content.parameters, editable: c.version.status === 'DRAFT', edits: this.edits, errors: this.errors, filter: this.filter, onEdit: () => undefined }));
    if (this.diff) sections.push(renderDiff(this.diff.rows, this.diff.base, this.diff.cand));
    sections.push(renderActivations({ rows: this.activations, canActivate: c?.version.status === 'APPROVED', onActivate: (o) => void this.activate(o), onRollback: (id) => void this.rollback(id) }),
      renderResolve(this.resolved, (t, i) => void this.resolve(t, i)), renderPlaceholders(this.experiments, c?.content.recipes ?? []));
    this.root.replaceChildren(...sections);
    if (keep) this.root.querySelector<HTMLInputElement>(`input[data-path="${keep}"]`)?.focus();
  }
}
