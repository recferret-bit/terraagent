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

export interface DefendAreaTarget {
  kind: 'defend_area';
  q: number;
  r: number;
  radius: number;
  durationH: number;
}

export type BountyTarget = ClearNestTarget | DefendAreaTarget;

export interface BountyRecord {
  id: string;
  /** Poster colony index. */
  poster: number;
  target: BountyTarget;
  /** Claimer colony indexes. The poster may be one of them. `defend_area` keeps one. */
  claimers: number[];
  state: BountyState;
  reward: { resource: T1ResourceKey; amount: number };
  expiresAt: number;
  /** Defend window, inclusive start and exclusive end. Absent on `clear_nest`. */
  startTick?: number;
  endTick?: number;
  presentTicks?: number;
}

export interface DefendBounty extends BountyRecord {
  target: DefendAreaTarget;
  startTick: number;
  endTick: number;
  presentTicks: number;
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
  return bounty.target.kind === 'clear_nest' && bounty.target.nestId === nestId && isOpenBounty(bounty);
}

export function isDefendBounty(bounty: BountyRecord): bounty is DefendBounty {
  return bounty.target.kind === 'defend_area' && isTick(bounty.startTick) && isTick(bounty.endTick) && isTick(bounty.presentTicks);
}

export function isOpenBounty(bounty: BountyRecord): boolean {
  return bounty.state === 'open' || bounty.state === 'claimed';
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
  const record: BountyRecord = {
    id: row.id,
    poster: row.poster,
    target,
    claimers: readClaimers(row.claimers),
    state: row.state,
    reward,
    expiresAt: row.expiresAt,
  };
  if (target.kind !== 'defend_area') return record;
  if (!isTick(row.startTick) || !isTick(row.endTick) || !isTick(row.presentTicks) || row.endTick <= row.startTick) return null;
  return { ...record, startTick: row.startTick, endTick: row.endTick, presentTicks: row.presentTicks };
}

function readTarget(raw: unknown): BountyTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { kind?: unknown; nestId?: unknown; q?: unknown; r?: unknown; radius?: unknown; durationH?: unknown };
  if (row.kind === 'clear_nest' && isId(row.nestId)) return { kind: 'clear_nest', nestId: row.nestId };
  if (row.kind !== 'defend_area' || !isTile(row.q) || !isTile(row.r)) return null;
  if (!isRadius(row.radius) || typeof row.durationH !== 'number' || !Number.isFinite(row.durationH) || row.durationH <= 0) return null;
  return { kind: 'defend_area', q: row.q, r: row.r, radius: row.radius, durationH: row.durationH };
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

function isTick(value: unknown): value is number {
  return isIndex(value);
}

function isTile(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isRadius(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 8;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80;
}
