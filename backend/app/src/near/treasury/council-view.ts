import { TREASURY_EFFECT_KINDS, TreasuryEffectKind, TreasuryProposalPush, type FlagSet } from '@terra/contracts';
import type { DaoProposalView, DaoView } from '../application/ports/treasury-dao.port.js';
import { treasuryProject } from './costs.js';
import type { NearTreasuryProposalBusEvent } from './proposal-push.js';

export interface TreasuryProposalResponse {
  readonly proposalId: number;
  readonly proposer: string;
  readonly kind: string;
  readonly description: string;
  readonly state: string;
  readonly yes: number;
  readonly no: number;
  readonly cost: string;
  readonly deadlineMs: number;
  readonly votes: DaoProposalView['votes'];
}

/** One council project and its table cost (`shared/sim/src/data/treasury.ts`). */
export interface TreasuryProjectResponse {
  readonly kind: string;
  readonly cost: string;
  readonly durationH: number;
  readonly magnitudeBp: number;
  readonly visits: number;
}

/**
 * `effects` stays empty. The finalize job posts `system.treasuryEffect`; the sim holds the timer (BE-82).
 * `projects` is every treasury-table row still enabled, including `guild_subsidy` while W15 is off.
 */
export interface TreasuryCouncilResponse {
  readonly planetId: string;
  readonly daoAccountId: string;
  readonly balance: Readonly<Record<string, string>>;
  readonly members: DaoView['members'];
  readonly effects: readonly [];
  readonly proposals: readonly TreasuryProposalResponse[];
  readonly projects: readonly TreasuryProjectResponse[];
}

export interface StoredProposalMeta {
  readonly cost?: string;
  readonly deadlineMs?: number;
}

export function toCouncil(
  planetId: string,
  view: DaoView,
  meta: ReadonlyMap<number, StoredProposalMeta>,
  flags: FlagSet,
): TreasuryCouncilResponse {
  return {
    planetId,
    daoAccountId: view.daoAccountId,
    balance: view.balances,
    members: view.members,
    effects: [],
    proposals: view.proposals.map((row) => toProposal(row, meta.get(row.proposalId), flags)),
    projects: listedProjects(flags),
  };
}

/** Table costs for the Council form. A kind whose wave is off is omitted; `guild_subsidy` is wave W22. */
function listedProjects(flags: FlagSet): TreasuryProjectResponse[] {
  const projects: TreasuryProjectResponse[] = [];
  for (const kind of TREASURY_EFFECT_KINDS) {
    const row = treasuryProject(flags, kind);
    if (!row) continue;
    projects.push({
      kind: row.kind,
      cost: row.cost,
      durationH: row.durationH,
      magnitudeBp: row.magnitudeBp,
      visits: row.visits,
    });
  }
  return projects;
}

export function toProposal(row: DaoProposalView, meta: StoredProposalMeta | undefined, flags: FlagSet): TreasuryProposalResponse {
  const priced = treasuryProject(flags, row.kind);
  return {
    proposalId: row.proposalId,
    proposer: row.proposer,
    kind: row.kind,
    description: row.description,
    state: row.state,
    yes: row.yes,
    no: row.no,
    votes: row.votes,
    cost: meta?.cost ?? priced?.cost ?? '0',
    deadlineMs: meta?.deadlineMs ?? 0,
  };
}

/** `kind` JSON written by the mock (`cost` plus `payload.deadlineMs`). */
export function storedProposalMeta(kind: unknown): StoredProposalMeta {
  if (typeof kind !== 'object' || kind === null || Array.isArray(kind)) return {};
  const row = kind as Record<string, unknown>;
  const payload = isRecord(row.payload) ? row.payload : {};
  const cost = typeof row.cost === 'string' ? row.cost : typeof payload.cost === 'string' ? payload.cost : undefined;
  const deadlineMs = typeof payload.deadlineMs === 'number' && Number.isInteger(payload.deadlineMs) ? payload.deadlineMs : undefined;
  return { ...(cost !== undefined ? { cost } : {}), ...(deadlineMs !== undefined ? { deadlineMs } : {}) };
}

export function proposalBusEvent(
  planetId: string,
  view: DaoView,
  proposalId: number,
  cost: string,
  deadlineMs: number,
): NearTreasuryProposalBusEvent | null {
  const row = view.proposals.find((proposal) => proposal.proposalId === proposalId);
  const kind = row ? TreasuryEffectKind.safeParse(row.kind) : null;
  if (!row || !kind?.success) return null;
  const payload = TreasuryProposalPush.parse({
    planetId,
    daoAccountId: view.daoAccountId,
    proposalId,
    kind: kind.data,
    state: row.state,
    yes: row.yes,
    no: row.no,
    members: view.members.length,
    deadlineMs,
    cost,
  });
  return { planetId, payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
