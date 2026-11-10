import type { Prisma } from '@terra/db';
import { AccountId } from '../domain/types.js';
import type { DaoVoteValue, StoredVote } from './pass-rule.js';

export type { DaoVoteValue, StoredVote };

export const DEFAULT_COST_TOKEN = 'metals.t1';
const WHOLE_UNITS = /^(0|[1-9]\d*)$/;
const DAO_SUFFIX = '.dao.mock';
const MAX_BASE = 64 - DAO_SUFFIX.length;

export interface DaoMember {
  readonly accountId: string;
  readonly canPropose: boolean;
}

/** Council state stored in `MockChainDao.policy` (no extra tables). */
export interface DaoPolicy {
  readonly name: string;
  readonly members: readonly DaoMember[];
  readonly balances: Readonly<Record<string, string>>;
}

export type ProposalStatus = 'InProgress' | 'Approved' | 'Rejected' | 'Expired';

export interface StoredProposal {
  readonly id: number;
  readonly proposer: string;
  readonly status: ProposalStatus;
  readonly votes: readonly StoredVote[];
  readonly kind: string;
  readonly description: string;
  readonly payload: Record<string, unknown>;
  readonly cost?: string;
  readonly tokenId?: string;
  readonly debited: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** `{slug}.dao.mock`: lowercase, `.` kept, other gaps become `-`. */
export function daoAccountIdFor(name: string): string {
  const parts = name.toLowerCase().split('.').map(slugSegment).filter((part) => part.length > 0);
  let base = parts.join('.') || 'dao';
  if (base.length > MAX_BASE) {
    const trimmed = base.slice(0, MAX_BASE).replace(/[._-]+$/g, '');
    base = trimmed.split('.').map(slugSegment).filter((part) => part.length > 0).join('.') || 'dao';
  }
  return AccountId.parse(`${base}${DAO_SUFFIX}`);
}

function slugSegment(raw: string): string {
  return raw.replace(/[^a-z0-9_-]+/g, '-').replace(/[-_]{2,}/g, (run) => run.charAt(0)).replace(/^[-_]+|[-_]+$/g, '');
}

export function initialPolicy(name: string, council: readonly string[]): DaoPolicy {
  const trimmed = name.trim();
  const members: DaoMember[] = [];
  const seen = new Set<string>();
  for (const accountId of council) {
    if (seen.has(accountId)) continue;
    seen.add(accountId);
    members.push({ accountId, canPropose: true });
  }
  return { name: trimmed.length > 0 ? trimmed : 'dao', members, balances: {} };
}

export function parsePolicy(raw: unknown): DaoPolicy {
  const obj = isRecord(raw) ? raw : {};
  const name = typeof obj.name === 'string' && obj.name.length > 0 ? obj.name : 'dao';
  return { name, members: readMembers(obj.members), balances: readBalances(obj.balances) };
}

function readMembers(raw: unknown): DaoMember[] {
  if (!Array.isArray(raw)) return [];
  const members: DaoMember[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || typeof item.accountId !== 'string' || seen.has(item.accountId)) continue;
    seen.add(item.accountId);
    members.push({ accountId: item.accountId, canPropose: item.canPropose !== false });
  }
  return members;
}

function readBalances(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const balances: Record<string, string> = {};
  for (const [tokenId, amount] of Object.entries(raw)) {
    if (typeof amount === 'string' && WHOLE_UNITS.test(amount)) balances[tokenId] = amount;
  }
  return balances;
}

export function balanceOf(policy: DaoPolicy, tokenId: string): bigint {
  const raw = policy.balances[tokenId] ?? '0';
  return WHOLE_UNITS.test(raw) ? BigInt(raw) : 0n;
}

export function covers(policy: DaoPolicy, tokenId: string, amount: string): boolean {
  return balanceOf(policy, tokenId) >= BigInt(amount);
}

export function creditBalance(policy: DaoPolicy, tokenId: string, amount: string): DaoPolicy {
  const next = (balanceOf(policy, tokenId) + BigInt(amount)).toString();
  return { ...policy, balances: { ...policy.balances, [tokenId]: next } };
}

/** `null` when the debit would go negative. The caller leaves the proposal `InProgress`. */
export function debitBalance(policy: DaoPolicy, tokenId: string, amount: string): DaoPolicy | null {
  const have = balanceOf(policy, tokenId);
  const need = BigInt(amount);
  if (have < need) return null;
  return { ...policy, balances: { ...policy.balances, [tokenId]: (have - need).toString() } };
}

/** A whole-unit `payload.cost` is priced in `payload.tokenId`, or `metals.t1` when that is omitted. */
export function readCost(payload: Record<string, unknown>): { cost?: string; tokenId?: string } {
  const cost = payload.cost;
  if (typeof cost !== 'string' || !WHOLE_UNITS.test(cost)) return {};
  const token = payload.tokenId;
  const tokenId = typeof token === 'string' && token.length > 0 && token.length <= 64 ? token : DEFAULT_COST_TOKEN;
  return { cost, tokenId };
}

export function proposalKindJson(proposal: StoredProposal): Prisma.InputJsonValue {
  return {
    kind: proposal.kind,
    description: proposal.description,
    payload: asJson(proposal.payload),
    ...(proposal.cost !== undefined ? { cost: proposal.cost, tokenId: proposal.tokenId ?? DEFAULT_COST_TOKEN } : {}),
    debited: proposal.debited,
  };
}

export function readProposal(row: { id: number; proposer: string; status: string; votes: unknown; kind: unknown }): StoredProposal {
  const kind = kindRecord(row.kind);
  const payload = isRecord(kind.payload) ? kind.payload : {};
  const priced = readStoredPrice(kind, payload);
  return {
    id: row.id,
    proposer: row.proposer,
    status: isStatus(row.status) ? row.status : 'InProgress',
    votes: readVotes(row.votes),
    kind: typeof kind.kind === 'string' && kind.kind.length > 0 ? kind.kind : 'unknown',
    description: typeof kind.description === 'string' ? kind.description : '',
    payload,
    cost: priced.cost,
    tokenId: priced.tokenId,
    debited: kind.debited === true,
  };
}

function readStoredPrice(kind: Record<string, unknown>, payload: Record<string, unknown>): { cost?: string; tokenId?: string } {
  const stored = readCost({ cost: kind.cost, tokenId: kind.tokenId ?? payload.tokenId });
  return stored.cost !== undefined ? stored : readCost(payload);
}

function kindRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') return { kind: raw };
  return isRecord(raw) ? raw : {};
}

function isStatus(value: string): value is ProposalStatus {
  return value === 'InProgress' || value === 'Approved' || value === 'Rejected' || value === 'Expired';
}

function readVotes(raw: unknown): StoredVote[] {
  if (!Array.isArray(raw)) return [];
  const votes: StoredVote[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.voter !== 'string') continue;
    if (item.vote !== 'approve' && item.vote !== 'reject' && item.vote !== 'remove') continue;
    votes.push({ voter: item.voter, vote: item.vote });
  }
  return votes;
}

/** `null` when a stored cost cannot be paid. No cost, or an already-debited cost, is a no-op. */
export function settleCost(policy: DaoPolicy, proposal: StoredProposal): { policy: DaoPolicy; debited: boolean } | null {
  if (proposal.debited || proposal.cost === undefined || proposal.tokenId === undefined) {
    return { policy, debited: true };
  }
  const next = debitBalance(policy, proposal.tokenId, proposal.cost);
  if (!next) return null;
  return { policy: next, debited: true };
}
