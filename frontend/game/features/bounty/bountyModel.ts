export const BOUNTY_SECTIONS = [
  { id: 'open', label: 'Open' },
  { id: 'claimed', label: 'Claimed' },
  { id: 'completed', label: 'Completed' },
  { id: 'expired', label: 'Expired' },
] as const;

export type BountySectionId = (typeof BOUNTY_SECTIONS)[number]['id'];

const RESOURCES = ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'] as const;
export type BountyResource = (typeof RESOURCES)[number];

const STATE_LABEL: Record<string, string> = {
  open: 'Open',
  pending: 'Open',
  claimed: 'Claimed',
  completed: 'Completed',
  paid: 'Paid',
  expired: 'Expired',
  refunded: 'Refunded',
};

/** API codes are shown as themselves. A missing code is no line. */
const ERROR_TEXT: Record<string, string> = {
  REQUEST_FAILED: 'The bounty board could not be reached.',
};

export interface BountyMenuItem {
  readonly id: 'bounties';
  readonly label: 'Bounties';
}

export interface BountyRowView {
  readonly id: string;
  readonly section: BountySectionId;
  readonly title: string;
  readonly state: string;
  readonly detail: string;
  readonly progress: string | null;
  readonly claim: boolean;
  readonly receiptHref: string | null;
}

export interface BountyView {
  readonly menuItem: BountyMenuItem | null;
  readonly sections: Readonly<Record<BountySectionId, readonly BountyRowView[]>>;
  readonly empty: boolean;
  readonly error: string | null;
}

export interface BountyQuery {
  readonly w22: boolean;
  readonly payload?: unknown;
  readonly errorCode?: string | null;
}

export interface BountyDraft {
  readonly kind: string;
  readonly nestId: string;
  readonly q: string;
  readonly r: string;
  readonly radius: string;
  readonly durationH: string;
  readonly deliverResource: string;
  readonly deliverAmount: string;
  readonly rewardResource: string;
  readonly rewardAmount: string;
  readonly expiryH: string;
}

export interface BountyPostArgs {
  readonly target: Record<string, unknown>;
  readonly reward: { readonly resource: string; readonly amount: number };
  readonly expiresAt: number;
}

const HOUR_MS = 3_600_000;

const EMPTY_SECTIONS: BountyView['sections'] = { open: [], claimed: [], completed: [], expired: [] };

const EMPTY: BountyView = { menuItem: null, sections: EMPTY_SECTIONS, empty: true, error: null };

export function bountyErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return ERROR_TEXT[code] ?? code;
}

export function bountyStateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

/** Board model. Wave off drops the menu item and every row. Progress is only text the payload already carries. */
export function bountyView(query: BountyQuery): BountyView {
  if (!query.w22) return EMPTY;
  const sections = splitRows(rowsOf(query.payload));
  const empty = BOUNTY_SECTIONS.every((section) => sections[section.id].length === 0);
  return { menuItem: { id: 'bounties', label: 'Bounties' }, sections, empty, error: bountyErrorText(query.errorCode) };
}

export function bountySignature(view: BountyView): string {
  return JSON.stringify(view);
}

/** Target, reward, and expiry for `POST /v1/bounties/:planetId`. Null when the draft is not a whole post. */
export function bountyPostArgs(draft: BountyDraft, nowMs: number): BountyPostArgs | null {
  const amount = whole(draft.rewardAmount);
  const hours = whole(draft.expiryH);
  if (!amount || !hours || !isResource(draft.rewardResource)) return null;
  const target = targetOf(draft);
  if (!target) return null;
  // The server rejects a span even 1 ms under 2 h. The post round-trip is that 1 ms.
  const slack = hours < 48 ? 5_000 : 0;
  return { target, reward: { resource: draft.rewardResource, amount }, expiresAt: nowMs + hours * HOUR_MS + slack };
}

function splitRows(rows: readonly BountyRowView[]): BountyView['sections'] {
  const sections: Record<BountySectionId, BountyRowView[]> = { open: [], claimed: [], completed: [], expired: [] };
  for (const row of rows) sections[row.section].push(row);
  return sections;
}

function rowsOf(payload: unknown): BountyRowView[] {
  const raw = Array.isArray(payload) ? payload : field(payload, 'bounties');
  if (!Array.isArray(raw)) return [];
  const out: BountyRowView[] = [];
  for (const row of raw) {
    const parsed = oneRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

function oneRow(row: unknown): BountyRowView | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.id !== 'string' || rec.id.length === 0) return null;
  const rawState = typeof rec.state === 'string' ? rec.state : 'open';
  const board = typeof rec.board === 'string' && rec.board.length > 0 ? rec.board : null;
  return {
    id: rec.id,
    section: sectionOf(rawState),
    title: titleOf(rec.target),
    state: board ?? bountyStateLabel(rawState),
    detail: rewardOf(rec.reward),
    progress: progressOf(rec),
    claim: rawState === 'open',
    receiptHref: receiptOf(rec),
  };
}

function sectionOf(state: string): BountySectionId {
  if (state === 'claimed') return 'claimed';
  if (state === 'completed' || state === 'paid') return 'completed';
  if (state === 'expired' || state === 'refunded') return 'expired';
  return 'open';
}

function titleOf(target: unknown): string {
  if (!target || typeof target !== 'object') return 'Bounty';
  const t = target as Record<string, unknown>;
  if (t.kind === 'clear_nest') return `Clear nest ${text(t.nestId)}`;
  if (t.kind === 'defend_area') return `Defend ${text(t.q)},${text(t.r)}`;
  if (t.kind === 'deliver_units') return `Deliver ${text(t.amount)} ${text(t.resource)}`;
  return text(t.kind) || 'Bounty';
}

function rewardOf(reward: unknown): string {
  if (!reward || typeof reward !== 'object') return '';
  const rec = reward as Record<string, unknown>;
  return typeof rec.amount === 'number' && typeof rec.resource === 'string' ? `${rec.amount} ${rec.resource}` : '';
}

/** Defend % or deliver x/y only when the list payload includes them. No client counter. */
function progressOf(rec: Record<string, unknown>): string | null {
  if (typeof rec.defendPercent === 'number' && Number.isFinite(rec.defendPercent)) {
    return `defend ${Math.round(rec.defendPercent)}%`;
  }
  if (typeof rec.defendBp === 'number' && Number.isFinite(rec.defendBp))
    return `defend ${Math.round(rec.defendBp / 100)}%`;
  const have = typeof rec.delivered === 'number' ? rec.delivered : null;
  const need = typeof rec.deliverTarget === 'number' ? rec.deliverTarget : null;
  return have !== null && need !== null ? `deliver ${have}/${need}` : null;
}

function receiptOf(rec: Record<string, unknown>): string | null {
  if (typeof rec.escrowTx === 'string' && rec.escrowTx.length > 0)
    return `/dev/chain/tx/${encodeURIComponent(rec.escrowTx)}`;
  return typeof rec.escrowId === 'string' && rec.escrowId.length > 0 ? '/dev/chain/?tab=escrow' : null;
}

function targetOf(draft: BountyDraft): Record<string, unknown> | null {
  if (draft.kind === 'clear_nest')
    return draft.nestId.trim() ? { kind: 'clear_nest', nestId: draft.nestId.trim() } : null;
  if (draft.kind === 'defend_area') return defendTarget(draft);
  if (draft.kind === 'deliver_units') return deliverTarget(draft);
  return null;
}

function defendTarget(draft: BountyDraft): Record<string, unknown> | null {
  const q = coord(draft.q);
  const r = coord(draft.r);
  const radius = whole(draft.radius);
  const durationH = positive(draft.durationH);
  if (q === null || r === null || !radius || radius > 8 || durationH === null) return null;
  return { kind: 'defend_area', q, r, radius, durationH };
}

function deliverTarget(draft: BountyDraft): Record<string, unknown> | null {
  const amount = whole(draft.deliverAmount);
  if (!amount || !isResource(draft.deliverResource)) return null;
  return { kind: 'deliver_units', resource: draft.deliverResource, amount };
}

function isResource(value: string): value is BountyResource {
  return (RESOURCES as readonly string[]).includes(value);
}

function whole(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

function coord(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= -32768 && n <= 32767 ? n : null;
}

function positive(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
}
