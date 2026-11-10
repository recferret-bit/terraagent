import { EFFECT_TICK_SECONDS, formatEffectTimer } from './effectModel';

const KIND_LABEL: Record<string, string> = {
  meteor_shield: 'Meteor shield',
  terraform_boost: 'Terraform boost',
  guild_subsidy: 'Guild subsidy',
};

const EFFECT_ORDER = ['meteor_shield', 'terraform_boost', 'guild_subsidy'];

/** Lines for API `errorCode` values. Unknown codes are shown as themselves. Never throws. */
const ERROR_TEXT: Record<string, string> = {
  TREASURY_INSUFFICIENT: 'The planet treasury cannot cover this project.',
  treasury_insufficient: 'The planet treasury cannot cover this project.',
  NOT_A_MEMBER: 'That colony is not a member of this planet council.',
  not_a_member: 'That colony is not a member of this planet council.',
  ALREADY_VOTED: 'This colony already voted on that proposal.',
  already_voted: 'This colony already voted on that proposal.',
  PROPOSAL_CLOSED: 'That proposal is no longer open.',
  proposal_closed: 'That proposal is no longer open.',
  PROPOSAL_OPEN: 'This colony already has an open council proposal.',
  DAO_NOT_FOUND: 'No planet council with this id.',
  dao_not_found: 'No planet council with this id.',
  REQUEST_FAILED: 'The council could not be reached.',
};

export interface CouncilMenuItem {
  readonly id: 'council';
  readonly label: 'Council';
}

export interface CouncilProposalRow {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly state: string;
  readonly yes: number;
  readonly no: number;
  readonly votes: string;
  readonly cost: string;
  readonly deadline: string;
  readonly open: boolean;
}

export interface CouncilProjectRow {
  readonly kind: string;
  readonly label: string;
  readonly cost: string;
}

export interface CouncilEffectRow {
  readonly kind: string;
  readonly label: string;
  readonly timer: string;
}

export interface CouncilView {
  readonly menuItem: CouncilMenuItem | null;
  readonly balance: string;
  readonly members: readonly string[];
  readonly memberCount: number;
  readonly effects: readonly CouncilEffectRow[];
  readonly proposals: readonly CouncilProposalRow[];
  readonly projects: readonly CouncilProjectRow[];
  readonly empty: boolean;
  readonly error: string | null;
}

export interface CouncilQuery {
  readonly w22: boolean;
  readonly payload?: unknown;
  /** Sim blob (`blobs.treasury`). GET `effects` stays empty until W22-09. */
  readonly treasury?: unknown;
  readonly tick?: number;
  readonly errorCode?: string | null;
  readonly nowMs?: number;
}

const EMPTY: CouncilView = {
  menuItem: null,
  balance: '',
  members: [],
  memberCount: 0,
  effects: [],
  proposals: [],
  projects: [],
  empty: true,
  error: null,
};

export function councilKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** Player line for an API error code. A missing code is no line. Does not throw. */
export function councilErrorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return ERROR_TEXT[code] ?? code;
}

export function voteCountText(yes: number, no: number): string {
  return `${yes} yes · ${no} no`;
}

/** Council sheet model. Wave off drops the menu item and every field, even when a payload is set. */
export function councilView(query: CouncilQuery): CouncilView {
  if (!query.w22) return EMPTY;
  const members = memberNames(field(query.payload, 'members'));
  const proposals = proposalRows(query.payload, query.nowMs ?? Date.now());
  return {
    menuItem: { id: 'council', label: 'Council' },
    balance: balanceText(field(query.payload, 'balance')),
    members,
    memberCount: members.length,
    effects: effectRows(query),
    proposals,
    projects: projectRows(field(query.payload, 'projects')),
    empty: proposals.length === 0,
    error: councilErrorText(query.errorCode),
  };
}

/** Fold one `treasury.proposal` push into the last GET body so the vote count updates without a reload. */
export function mergeProposalPush(payload: unknown, push: unknown): unknown {
  if (!push || typeof push !== 'object') return payload;
  const row = push as Record<string, unknown>;
  if (typeof row.proposalId !== 'number') return payload;
  const base = payload && typeof payload === 'object' ? { ...(payload as Record<string, unknown>) } : {};
  const proposals = Array.isArray(base.proposals) ? [...base.proposals] : [];
  const next = {
    proposalId: row.proposalId,
    kind: row.kind,
    state: row.state,
    yes: row.yes,
    no: row.no,
    cost: row.cost,
    deadlineMs: row.deadlineMs,
  };
  const idx = proposals.findIndex((item) => sameId(item, row.proposalId));
  if (idx >= 0) proposals[idx] = { ...(proposals[idx] as Record<string, unknown>), ...next };
  else proposals.push(next);
  return { ...base, proposals };
}

export function councilSignature(view: CouncilView): string {
  return JSON.stringify(view);
}

export function formatDeadline(ms: number, now: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const left = ms - now;
  if (left <= 0) return 'closed';
  const mins = Math.ceil(left / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

function proposalRows(payload: unknown, now: number): CouncilProposalRow[] {
  const raw = field(payload, 'proposals');
  if (!Array.isArray(raw)) return [];
  const out: CouncilProposalRow[] = [];
  for (const row of raw) {
    const parsed = oneProposal(row, now);
    if (parsed) out.push(parsed);
  }
  return out;
}

function oneProposal(row: unknown, now: number): CouncilProposalRow | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;
  const id = rec.proposalId ?? rec.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const kind = typeof rec.kind === 'string' ? rec.kind : 'project';
  const yes = countOf(rec.yes);
  const no = countOf(rec.no);
  const state = typeof rec.state === 'string' ? rec.state : 'InProgress';
  const deadlineMs = typeof rec.deadlineMs === 'number' ? rec.deadlineMs : 0;
  return {
    id: String(id),
    kind,
    label: councilKindLabel(kind),
    state,
    yes,
    no,
    votes: voteCountText(yes, no),
    cost: amountText(rec.cost),
    deadline: formatDeadline(deadlineMs, now),
    open: state === 'InProgress',
  };
}

function projectRows(raw: unknown): CouncilProjectRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CouncilProjectRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { kind?: unknown; cost?: unknown };
    if (typeof rec.kind !== 'string') continue;
    if (typeof rec.cost !== 'string' && typeof rec.cost !== 'number') continue;
    out.push({ kind: rec.kind, label: councilKindLabel(rec.kind), cost: amountText(rec.cost) });
  }
  return out;
}

function effectRows(query: CouncilQuery): CouncilEffectRow[] {
  const bag = new Map<string, number>();
  collectEffects(bag, query.treasury);
  collectEffects(bag, field(query.payload, 'effects'));
  const kinds = [...EFFECT_ORDER.filter((kind) => bag.has(kind)), ...[...bag.keys()].filter((kind) => !EFFECT_ORDER.includes(kind))];
  const out: CouncilEffectRow[] = [];
  for (const kind of kinds) {
    const timer = timerFor(query.tick ?? Number.NaN, bag.get(kind) ?? 0);
    if (!timer) continue;
    out.push({ kind, label: councilKindLabel(kind), timer });
  }
  return out;
}

function collectEffects(bag: Map<string, number>, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  if (Array.isArray(raw)) {
    for (const row of raw) addEffect(bag, row);
    return;
  }
  const obj = raw as { value?: unknown; effects?: unknown; kind?: unknown };
  if (obj.value && typeof obj.value === 'object') collectEffects(bag, obj.value);
  if (obj.effects && typeof obj.effects === 'object') {
    collectEffects(bag, obj.effects);
    return;
  }
  if (typeof obj.kind === 'string') addEffect(bag, obj);
  else if (!Array.isArray(raw)) {
    for (const [kind, row] of Object.entries(raw as Record<string, unknown>)) addEffect(bag, row, kind);
  }
}

function addEffect(bag: Map<string, number>, row: unknown, kind?: string): void {
  if (!row || typeof row !== 'object') return;
  const rec = row as { kind?: unknown; untilTick?: unknown };
  const name = kind ?? (typeof rec.kind === 'string' ? rec.kind : '');
  if (!name || typeof rec.untilTick !== 'number' || !Number.isFinite(rec.untilTick)) return;
  bag.set(name, rec.untilTick);
}

function timerFor(tick: number, until: number): string | null {
  if (!Number.isFinite(tick) || !(tick < until)) return null;
  const seconds = Math.max(0, until - tick) * EFFECT_TICK_SECONDS;
  if (!(seconds > 0)) return null;
  return formatEffectTimer(seconds);
}

function memberNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const row of raw) {
    if (typeof row === 'string') names.push(row);
    else if (row && typeof row === 'object' && typeof (row as { accountId?: unknown }).accountId === 'string') {
      names.push((row as { accountId: string }).accountId);
    }
  }
  return names;
}

function balanceText(raw: unknown): string {
  if (typeof raw === 'number' || typeof raw === 'string') return amountText(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '0';
  const rec = raw as Record<string, unknown>;
  if ('metals.t1' in rec) return amountText(rec['metals.t1']);
  const first = Object.values(rec)[0];
  return first === undefined ? '0' : amountText(first);
}

function amountText(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string') return raw;
  return '0';
}

function field(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== 'object') return undefined;
  return (payload as Record<string, unknown>)[key];
}

function countOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function sameId(item: unknown, id: unknown): boolean {
  return Boolean(item && typeof item === 'object' && (item as { proposalId?: unknown }).proposalId === id);
}
