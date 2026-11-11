import type { CouncilEffectRow, CouncilProjectRow, CouncilProposalRow, CouncilView } from './councilModel';

export interface CouncilActions {
  close(): void;
  propose(kind: string): void;
  vote(id: string, choice: 'approve' | 'reject'): void;
}

export interface CouncilDom {
  readonly root: HTMLElement;
  paint(view: CouncilView): void;
}

interface Slots {
  balance: HTMLElement;
  members: HTMLElement;
  effects: HTMLElement;
  error: HTMLElement;
  proposals: HTMLElement;
  empty: HTMLElement;
  kind: HTMLSelectElement;
  propose: HTMLButtonElement;
}

/** Sheet built once. Later paints only replace text and the proposal rows. */
export function mountCouncilSheet(parent: HTMLElement, actions: CouncilActions): CouncilDom {
  const doc = parent.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'ta-council';
  root.dataset.testid = 'council-sheet';
  root.hidden = true;
  const sheet = doc.createElement('div');
  sheet.className = 'ta-council__sheet plate';
  const scroll = doc.createElement('div');
  scroll.className = 'ta-council__scroll';
  const head = doc.createElement('div');
  head.className = 'ta-council__head';
  const title = doc.createElement('h2');
  title.className = 'ta-council__title';
  title.textContent = 'Council';
  const close = button(doc, 'btn btn-ghost btn-sm', 'council-close', 'Close', () => actions.close());
  head.append(title, close);
  const slots = bodySlots(doc, scroll, actions);
  scroll.prepend(head);
  sheet.appendChild(scroll);
  root.appendChild(sheet);
  parent.appendChild(root);
  return { root, paint: (view) => paintSlots(slots, view, actions) };
}

function bodySlots(doc: Document, scroll: HTMLElement, actions: CouncilActions): Slots {
  const balance = span(doc, 'ta-council__balance', 'council-balance');
  const members = span(doc, '', 'council-members');
  const effects = doc.createElement('div');
  effects.dataset.testid = 'council-effects';
  const error = doc.createElement('p');
  error.className = 'ta-council__error';
  error.dataset.testid = 'council-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const proposals = doc.createElement('div');
  proposals.className = 'ta-council__proposals';
  proposals.dataset.testid = 'council-proposals';
  const empty = doc.createElement('p');
  empty.className = 'ta-council__empty';
  empty.dataset.testid = 'council-empty';
  const form = doc.createElement('form');
  form.className = 'ta-council__form';
  const kind = doc.createElement('select');
  kind.className = 'input';
  kind.dataset.testid = 'council-kind';
  kind.setAttribute('aria-label', 'Project');
  const propose = doc.createElement('button');
  propose.type = 'submit';
  propose.className = 'btn btn-primary btn-sm';
  propose.dataset.testid = 'council-propose';
  propose.textContent = 'Propose';
  form.append(kind, propose);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.propose(kind.value);
  });
  scroll.append(
    labeled(doc, 'Balance', balance),
    members,
    effects,
    error,
    proposals,
    empty,
    form,
  );
  return { balance, members, effects, error, proposals, empty, kind, propose };
}

function paintSlots(slots: Slots, view: CouncilView, actions: CouncilActions): void {
  write(slots.balance, view.balance);
  write(slots.members, memberLine(view));
  paintEffects(slots.effects, view.effects);
  write(slots.error, view.error ?? '');
  slots.error.hidden = view.error === null;
  paintProposals(slots.proposals, view.proposals, actions);
  write(slots.empty, view.empty ? 'No proposals' : '');
  slots.empty.hidden = !view.empty;
  paintProjects(slots.kind, view.projects);
  slots.propose.disabled = view.projects.length === 0;
}

function paintEffects(host: HTMLElement, effects: readonly CouncilEffectRow[]): void {
  const sig = effects.map((effect) => `${effect.kind}:${effect.timer}`).join('|');
  if (host.dataset.effects === sig) return;
  host.replaceChildren();
  for (const effect of effects) host.appendChild(effectRow(host.ownerDocument, effect));
  host.dataset.effects = sig;
  host.hidden = effects.length === 0;
}

function effectRow(doc: Document, effect: CouncilEffectRow): HTMLElement {
  const row = doc.createElement('div');
  row.className = 'ta-council__row';
  row.dataset.testid = `council-effect-${effect.kind}`;
  const name = doc.createElement('span');
  name.textContent = effect.label;
  const time = doc.createElement('span');
  time.dataset.testid = `council-effect-timer-${effect.kind}`;
  time.textContent = effect.timer;
  row.append(name, time);
  return row;
}

function paintProposals(host: HTMLElement, rows: readonly CouncilProposalRow[], actions: CouncilActions): void {
  const sig = rows.map((row) => `${row.id}:${row.state}:${row.votes}:${row.cost}:${row.deadline}`).join('|');
  if (host.dataset.rows === sig) return;
  host.replaceChildren();
  for (const row of rows) host.appendChild(proposalRow(host.ownerDocument, row, actions));
  host.dataset.rows = sig;
}

function proposalRow(doc: Document, row: CouncilProposalRow, actions: CouncilActions): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'ta-council__proposal';
  root.dataset.testid = `council-proposal-${row.id}`;
  root.append(
    textSpan(doc, row.label),
    textSpan(doc, row.state),
    textSpan(doc, row.cost, 'council-cost'),
    textSpan(doc, row.votes, 'council-votes'),
    textSpan(doc, row.deadline, 'council-deadline'),
  );
  if (row.open) root.appendChild(voteBar(doc, row, actions));
  return root;
}

function voteBar(doc: Document, row: CouncilProposalRow, actions: CouncilActions): HTMLElement {
  const bar = doc.createElement('div');
  bar.className = 'ta-council__votes';
  bar.append(
    button(doc, 'btn btn-primary btn-sm', `council-vote-yes-${row.id}`, 'Yes', () => actions.vote(row.id, 'approve')),
    button(doc, 'btn btn-ghost btn-sm', `council-vote-no-${row.id}`, 'No', () => actions.vote(row.id, 'reject')),
  );
  return bar;
}

function paintProjects(select: HTMLSelectElement, projects: readonly CouncilProjectRow[]): void {
  const sig = projects.map((project) => `${project.kind}:${project.cost}`).join('|');
  if (select.dataset.projects === sig) return;
  const selected = select.value;
  select.replaceChildren();
  for (const project of projects) {
    const opt = select.ownerDocument.createElement('option');
    opt.value = project.kind;
    opt.dataset.testid = `council-project-${project.kind}`;
    opt.textContent = `${project.label} · ${project.cost}`;
    select.appendChild(opt);
  }
  select.dataset.projects = sig;
  if ([...select.options].some((opt) => opt.value === selected)) select.value = selected;
}

function memberLine(view: CouncilView): string {
  const noun = view.memberCount === 1 ? '1 member' : `${view.memberCount} members`;
  return view.members.length === 0 ? noun : `${noun} · ${view.members.join(', ')}`;
}

function labeled(doc: Document, label: string, value: HTMLElement): HTMLElement {
  const row = doc.createElement('div');
  row.className = 'ta-council__row';
  const name = doc.createElement('span');
  name.className = 'field-label';
  name.textContent = label;
  row.append(name, value);
  return row;
}

function textSpan(doc: Document, text: string, testid?: string): HTMLElement {
  return span(doc, '', testid, text);
}

function span(doc: Document, cls: string, testid?: string, text?: string): HTMLElement {
  const el = doc.createElement('span');
  if (cls) el.className = cls;
  if (testid) el.dataset.testid = testid;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(doc: Document, cls: string, testid: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = cls;
  el.dataset.testid = testid;
  el.textContent = text;
  el.addEventListener('click', onClick);
  return el;
}

function write(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
