import { opId } from '../application/outbox/op-id.js';
import { compileData, dataRow } from '@terra/sim';

/** One hour in unix milliseconds. Policy hours stay design hours (not ticks). */
export const HOUR_MS = 3_600_000;

export const BOUNTY_REJECT_CODES = [
  'invalid_target',
  'invalid_args',
  'insufficient_cargo',
  'queue_full',
  'not_own_territory',
] as const;
export type BountyRejectCode = (typeof BOUNTY_REJECT_CODES)[number];

export interface BountyScreen {
  readonly code: BountyRejectCode;
  readonly detail: string;
}

export interface BountyPolicy {
  readonly maxActive: number;
  readonly expiryMinMs: number;
  readonly expiryMaxMs: number;
}

let policyData: ReturnType<typeof compileData> | undefined;

/** `bounty.policy` (max 3 active, expiry 2–48 h). Compiled with W22 on so the numbers exist even when the flag is off. */
export function bountyPolicy(): BountyPolicy {
  const row = dataRow(policyData ??= compileData(new Set(['W22'])), 'bounty', 'policy');
  return {
    maxActive: policyNum(row.maxActive),
    expiryMinMs: policyNum(row.expiryMinH) * HOUR_MS,
    expiryMaxMs: policyNum(row.expiryMaxH) * HOUR_MS,
  };
}

/** `invalid_args` when `expiresAt` is outside the policy window from `nowMs` (inclusive). */
export function expiryScreen(expiresAt: number, nowMs: number, policy: BountyPolicy = bountyPolicy()): BountyScreen | null {
  const span = expiresAt - nowMs;
  const minH = policy.expiryMinMs / HOUR_MS;
  const maxH = policy.expiryMaxMs / HOUR_MS;
  if (!Number.isInteger(expiresAt) || span < policy.expiryMinMs || span > policy.expiryMaxMs) {
    return { code: 'invalid_args', detail: `Expiry must be ${minH}–${maxH} h from now` };
  }
  return null;
}

/** `queue_full` when the colony already holds `maxActive` open or claimed bounties. */
export function activeScreen(activeCount: number, policy: BountyPolicy = bountyPolicy()): BountyScreen | null {
  if (activeCount >= policy.maxActive) {
    return { code: 'queue_full', detail: `At most ${policy.maxActive} active bounties` };
  }
  return null;
}

/** Outbox and escrow op. A second post of the same bounty id reuses it, so cargo is not debited twice. */
export function bountyOpenOpId(bountyId: string): string {
  return opId('bounty-open', bountyId);
}

const PAY_PREFIX = 'bounty-pay:';

/** Escrow claim op. A repeated pay of the same bounty replays this receipt (W22-23). */
export function bountyPayOpId(bountyId: string): string {
  return opId('bounty-pay', bountyId);
}

/** Bounty id stored in `bountyPayOpId`, or null when `op` is some other outbox row. */
export function bountyIdFromPayOp(op: string): string | null {
  return op.startsWith(PAY_PREFIX) && op.length > PAY_PREFIX.length ? op.slice(PAY_PREFIX.length) : null;
}

function policyNum(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error('bounty policy row is not a number');
  return n;
}
