import {
  BOUNTY_SECTIONS,
  type BountyDraft,
  type BountyRowView,
  type BountySectionId,
  type BountyView,
} from './bountyModel';

export interface BountyActions {
  close(): void;
  post(draft: BountyDraft): void;
  claim(id: string): void;
}

export interface BountyDom {
  readonly root: HTMLElement;
  paint(view: BountyView): void;
}

const RESOURCES: readonly { value: string; label: string }[] = [
  { value: 'metals.t1', label: 'Metals' },
  { value: 'minerals.t1', label: 'Minerals' },
  { value: 'bio.water', label: 'Water' },
  { value: 'bio.biomass', label: 'Biomass' },
];

interface Slots {
  error: HTMLElement;
  empty: HTMLElement;
  lists: Record<BountySectionId, HTMLElement>;
  sections: Record<BountySectionId, HTMLElement>;
}

/** Sheet built once. Later paints only replace text and the bounty rows. */
export function mountBountySheet(parent: HTMLElement, actions: BountyActions): BountyDom {
  const doc = parent.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'ta-bounty';
  root.dataset.testid = 'bounty-sheet';
  root.hidden = true;
  const sheet = doc.createElement('div');
  sheet.className = 'ta-bounty__sheet plate';
  const scroll = doc.createElement('div');
  scroll.className = 'ta-bounty__scroll';
  scroll.append(head(doc, actions), formOf(doc, actions));
  const slots = listSlots(doc, scroll);
  sheet.appendChild(scroll);
  root.appendChild(sheet);
  parent.appendChild(root);
  return { root, paint: (view) => paintSlots(slots, view, actions) };
}

function head(doc: Document, actions: BountyActions): HTMLElement {
  const row = doc.createElement('div');
  row.className = 'ta-bounty__head';
  const title = doc.createElement('h2');
  title.className = 'ta-bounty__title';
  title.textContent = 'Bounties';
  row.append(
    title,
    button(doc, 'btn btn-ghost btn-sm', 'bounty-close', 'Close', () => actions.close()),
  );
  return row;
}

function formOf(doc: Document, actions: BountyActions): HTMLFormElement {
  const form = doc.createElement('form');
  form.className = 'ta-bounty__form';
  const fields = formFields(doc);
  form.append(
    fields.kindWrap,
    fields.nestWrap,
    fields.qWrap,
    fields.rWrap,
    fields.radiusWrap,
    fields.durationWrap,
    fields.deliverResourceWrap,
    fields.deliverAmountWrap,
    fields.rewardResourceWrap,
    fields.rewardAmountWrap,
    fields.expiryWrap,
    button(doc, 'btn btn-primary btn-sm', 'bounty-post', 'Post', () => undefined),
  );
  const post = form.querySelector('button');
  if (post) post.type = 'submit';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.post(readDraft(fields));
  });
  return form;
}

function listSlots(doc: Document, scroll: HTMLElement): Slots {
  const error = note(doc, 'ta-bounty__error', 'bounty-error');
  error.setAttribute('role', 'alert');
  const empty = note(doc, 'ta-bounty__empty', 'bounty-empty');
  const lists = {} as Record<BountySectionId, HTMLElement>;
  const sections = {} as Record<BountySectionId, HTMLElement>;
  scroll.append(error);
  for (const section of BOUNTY_SECTIONS) {
    const block = sectionBlock(doc, section.id, section.label);
    lists[section.id] = block.list;
    sections[section.id] = block.root;
    scroll.appendChild(block.root);
  }
  scroll.appendChild(empty);
  return { error, empty, lists, sections };
}

function sectionBlock(doc: Document, id: BountySectionId, label: string): { root: HTMLElement; list: HTMLElement } {
  const root = doc.createElement('section');
  root.className = 'ta-bounty__section';
  root.dataset.testid = `bounty-section-${id}`;
  const title = doc.createElement('h3');
  title.className = 'ta-bounty__section-title';
  title.textContent = label;
  const list = doc.createElement('div');
  list.dataset.testid = `bounty-list-${id}`;
  root.append(title, list);
  return { root, list };
}

function paintSlots(slots: Slots, view: BountyView, actions: BountyActions): void {
  write(slots.error, view.error ?? '');
  slots.error.hidden = view.error === null;
  for (const section of BOUNTY_SECTIONS) paintList(slots, section.id, view.sections[section.id], actions);
  write(slots.empty, view.empty ? 'No bounties' : '');
  slots.empty.hidden = !view.empty;
}

function paintList(slots: Slots, id: BountySectionId, rows: readonly BountyRowView[], actions: BountyActions): void {
  const host = slots.lists[id];
  const sig = rows
    .map((row) => `${row.id}:${row.state}:${row.detail}:${row.progress}:${row.claim}:${row.receiptHref}`)
    .join('|');
  if (host.dataset.rows === sig) return;
  host.replaceChildren();
  for (const row of rows) host.appendChild(rowEl(host.ownerDocument, row, actions));
  host.dataset.rows = sig;
  slots.sections[id].hidden = rows.length === 0;
}

function rowEl(doc: Document, row: BountyRowView, actions: BountyActions): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'ta-bounty__row';
  root.dataset.testid = `bounty-row-${row.id}`;
  root.append(textSpan(doc, row.title), textSpan(doc, row.state, `bounty-state-${row.id}`), textSpan(doc, row.detail));
  if (row.progress) root.appendChild(textSpan(doc, row.progress, `bounty-progress-${row.id}`));
  if (row.receiptHref) root.appendChild(receiptLink(doc, row));
  if (row.claim)
    root.appendChild(
      button(doc, 'btn btn-primary btn-sm', `bounty-claim-${row.id}`, 'Claim', () => actions.claim(row.id)),
    );
  return root;
}

function receiptLink(doc: Document, row: BountyRowView): HTMLAnchorElement {
  const link = doc.createElement('a');
  link.className = 'ta-bounty__receipt';
  link.dataset.testid = `bounty-receipt-${row.id}`;
  link.href = row.receiptHref ?? '';
  link.textContent = 'Receipt';
  return link;
}

interface FormFields {
  kind: HTMLSelectElement;
  nest: HTMLInputElement;
  q: HTMLInputElement;
  r: HTMLInputElement;
  radius: HTMLInputElement;
  duration: HTMLInputElement;
  deliverResource: HTMLSelectElement;
  deliverAmount: HTMLInputElement;
  rewardResource: HTMLSelectElement;
  rewardAmount: HTMLInputElement;
  expiry: HTMLInputElement;
  kindWrap: HTMLElement;
  nestWrap: HTMLElement;
  qWrap: HTMLElement;
  rWrap: HTMLElement;
  radiusWrap: HTMLElement;
  durationWrap: HTMLElement;
  deliverResourceWrap: HTMLElement;
  deliverAmountWrap: HTMLElement;
  rewardResourceWrap: HTMLElement;
  rewardAmountWrap: HTMLElement;
  expiryWrap: HTMLElement;
}

function formFields(doc: Document): FormFields {
  const kind = select(doc, 'bounty-target', 'Target', [
    { value: 'clear_nest', label: 'Clear nest' },
    { value: 'defend_area', label: 'Defend area' },
    { value: 'deliver_units', label: 'Deliver units' },
  ]);
  const nest = input(doc, 'bounty-nest', '');
  const q = input(doc, 'bounty-q', '0');
  const r = input(doc, 'bounty-r', '0');
  const radius = input(doc, 'bounty-radius', '2');
  const duration = input(doc, 'bounty-duration', '2');
  const deliverResource = select(doc, 'bounty-deliver-resource', 'Deliver resource', RESOURCES);
  const deliverAmount = input(doc, 'bounty-deliver-amount', '100');
  const rewardResource = select(doc, 'bounty-reward-resource', 'Reward', RESOURCES);
  const rewardAmount = input(doc, 'bounty-reward', '200');
  const expiry = input(doc, 'bounty-expiry', '2');
  return {
    kind,
    nest,
    q,
    r,
    radius,
    duration,
    deliverResource,
    deliverAmount,
    rewardResource,
    rewardAmount,
    expiry,
    kindWrap: labeled(doc, 'Target', kind),
    nestWrap: labeled(doc, 'Nest', nest),
    qWrap: labeled(doc, 'Tile q', q),
    rWrap: labeled(doc, 'Tile r', r),
    radiusWrap: labeled(doc, 'Radius', radius),
    durationWrap: labeled(doc, 'Defend hours', duration),
    deliverResourceWrap: labeled(doc, 'Deliver', deliverResource),
    deliverAmountWrap: labeled(doc, 'Deliver amount', deliverAmount),
    rewardResourceWrap: labeled(doc, 'Reward', rewardResource),
    rewardAmountWrap: labeled(doc, 'Reward amount', rewardAmount),
    expiryWrap: labeled(doc, 'Expiry hours', expiry),
  };
}

function readDraft(fields: FormFields): BountyDraft {
  return {
    kind: fields.kind.value,
    nestId: fields.nest.value,
    q: fields.q.value,
    r: fields.r.value,
    radius: fields.radius.value,
    durationH: fields.duration.value,
    deliverResource: fields.deliverResource.value,
    deliverAmount: fields.deliverAmount.value,
    rewardResource: fields.rewardResource.value,
    rewardAmount: fields.rewardAmount.value,
    expiryH: fields.expiry.value,
  };
}

function labeled(doc: Document, label: string, control: HTMLElement): HTMLElement {
  const wrap = doc.createElement('label');
  wrap.className = 'ta-bounty__field';
  const name = doc.createElement('span');
  name.className = 'label';
  name.textContent = label;
  wrap.append(name, control);
  return wrap;
}

function select(
  doc: Document,
  testid: string,
  aria: string,
  options: readonly { value: string; label: string }[],
): HTMLSelectElement {
  const el = doc.createElement('select');
  el.className = 'input';
  el.dataset.testid = testid;
  el.setAttribute('aria-label', aria);
  for (const option of options) {
    const node = doc.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    el.appendChild(node);
  }
  return el;
}

function input(doc: Document, testid: string, value: string): HTMLInputElement {
  const el = doc.createElement('input');
  el.className = 'input';
  el.dataset.testid = testid;
  el.value = value;
  el.autocomplete = 'off';
  return el;
}

function note(doc: Document, cls: string, testid: string): HTMLElement {
  const el = doc.createElement('p');
  el.className = cls;
  el.dataset.testid = testid;
  el.hidden = true;
  return el;
}

function textSpan(doc: Document, text: string, testid?: string): HTMLElement {
  const el = doc.createElement('span');
  if (testid) el.dataset.testid = testid;
  el.textContent = text;
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
