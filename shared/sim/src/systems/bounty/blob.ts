import { T1_RESOURCE_KEYS, type T1ResourceKey } from '@terra/contracts/ws/sim';
import { setBlob, type PlanetState } from '../../kernel/state';
import { colonyWho } from '../find';

/** Open clear_nest bounties and the recent hive-damage ring (W22-20, SIM-V-05). */
export const BOUNTY_BLOB = 'bounty';

const T1: ReadonlySet<string> = new Set(T1_RESOURCE_KEYS);
const STATES = ['open', 'claimed', 'completed', 'refunded', 'paid'] as const;

export type BountyState = (typeof STATES)[number];

export interface ClearNestTarget {
  kind: 'clear_nest';
  nestId: string;
}

export interface BountyRecord {
  id: string;
  /** Poster colony index. */
  poster: number;
  target: ClearNestTarget;
  /** Claimer colony indexes. The poster may be one of them. */
  claimers: number[];
  state: BountyState;
  reward: { resource: T1ResourceKey; amount: number };
  expiresAt: number;
}

export interface NestDamageHit {
  nestId: string;
  colony: number;
  amount: number;
  tick: number;
}

export interface BountyBlobValue {
  bounties: BountyRecord[];
  damage: NestDamageHit[];
}

export function bountyColonyId(state: PlanetState, index: number): string {
  return colonyWho(state, index).colonyIdStr;
}

/** Event `colonyIds` for a claimer and a poster, without repeating one colony. */
export function bountyAudience(claimer: string, poster: string): string[] {
  return claimer === poster ? [claimer] : [claimer, poster];
}

/** An open or claimed clear_nest bounty on `nestId`. */
export function isLiveClearNest(bounty: BountyRecord, nestId: string): boolean {
  return bounty.target.nestId === nestId && (bounty.state === 'open' || bounty.state === 'claimed');
}

export function readBounty(state: PlanetState): BountyBlobValue {
  const raw = state.blobs[BOUNTY_BLOB]?.value;
  if (!raw || typeof raw !== 'object') return emptyBounty();
  const value = raw as { bounties?: unknown; damage?: unknown };
  return { bounties: readList(value.bounties, readBountyRecord), damage: readList(value.damage, readHit) };
}

export function writeBounty(state: PlanetState, value: BountyBlobValue, tick: number): void {
  setBlob(state, BOUNTY_BLOB, value, tick);
}

function emptyBounty(): BountyBlobValue {
  return { bounties: [], damage: [] };
}

function readList<T>(raw: unknown, read: (row: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const row of raw) {
    const item = read(row);
    if (item) out.push(item);
  }
  return out;
}

function readBountyRecord(raw: unknown): BountyRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<BountyRecord>;
  const target = readTarget(row.target);
  const reward = readReward(row.reward);
  if (!isId(row.id) || !isIndex(row.poster) || !target || !reward) return null;
  if (typeof row.expiresAt !== 'number' || !Number.isInteger(row.expiresAt) || row.expiresAt <= 0) return null;
  if (!isState(row.state)) return null;
  return {
    id: row.id,
    poster: row.poster,
    target,
    claimers: readClaimers(row.claimers),
    state: row.state,
    reward,
    expiresAt: row.expiresAt,
  };
}

function readTarget(raw: BountyRecord['target'] | undefined): ClearNestTarget | null {
  if (!raw || raw.kind !== 'clear_nest' || !isId(raw.nestId)) return null;
  return { kind: 'clear_nest', nestId: raw.nestId };
}

function readReward(raw: BountyRecord['reward'] | undefined): BountyRecord['reward'] | null {
  if (!raw || typeof raw.resource !== 'string' || !T1.has(raw.resource)) return null;
  if (typeof raw.amount !== 'number' || !Number.isInteger(raw.amount) || raw.amount <= 0) return null;
  return { resource: raw.resource as T1ResourceKey, amount: raw.amount };
}

function readClaimers(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isIndex);
}

function readHit(raw: unknown): NestDamageHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<NestDamageHit>;
  if (!isId(row.nestId) || !isIndex(row.colony)) return null;
  if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0) return null;
  if (typeof row.tick !== 'number' || !Number.isInteger(row.tick)) return null;
  return { nestId: row.nestId, colony: row.colony, amount: row.amount, tick: row.tick };
}

function isState(value: unknown): value is BountyState {
  return typeof value === 'string' && (STATES as readonly string[]).includes(value);
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80;
}
