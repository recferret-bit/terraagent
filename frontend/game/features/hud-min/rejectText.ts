import type { RejectCode } from '@terra/contracts';

/** Codes a toast can show: every host `RejectCode` plus the client's own `timeout` / `not_connected`. */
export type ToastRejectCode = RejectCode | 'timeout' | 'not_connected';

/**
 * One text per code, typed over every `RejectCode` so a new code cannot ship without one (FF-22). Wording that only
 * fits one command kind lives in `REJECT_TEXT_BY_KIND`.
 */
export const REJECT_TEXT: Readonly<Record<ToastRejectCode, string>> = {
  invalid_args: 'Rejected: Invalid order',
  unknown_kind: 'Rejected: Unknown order',
  not_own_colony: 'Rejected: Not your colony',
  colony_inactive: 'Rejected: Colony inactive',
  not_own_territory: 'Rejected: Not your territory',
  site_blocked: 'Rejected: Site blocked',
  terrain_unbuildable: 'Rejected: Terrain unbuildable',
  insufficient_resources: 'Waiting: Insufficient resources',
  supply_cap: 'Rejected: Supply cap reached',
  unknown_entity: 'Rejected: Unknown entity',
  tier_locked: 'Rejected: Tier locked',
  worker_tier_locked: 'Rejected: No worker available',
  stage_locked: 'Rejected: Not unlocked yet',
  no_trade_hub: 'Rejected: Requires Trade Hub',
  raid_protected: 'Rejected: Raid protection active',
  truce_active: 'Rejected: Truce active',
  would_isolate: 'Rejected: Would cut off part of the colony',
  launch_gate: 'Rejected: Launch gate closed',
  mint_cap: 'Rejected: Mint cap reached',
  market_unavailable: 'Rejected: Market unavailable',
  planet_ended: 'Rejected: Planet ended',
  wave_disabled: 'Rejected: Wave disabled',
  host_unavailable: 'Rejected: Game host unavailable',
  internal: 'Rejected: Internal error',
  rate_limited: 'Slow down: too many orders',
  already_landed: 'Rejected: Colony already landed',
  landing_site_taken: 'Rejected: Landing site taken or too close to another colony',
  queue_full: 'Rejected: Queue full',
  planet_full: 'Rejected: Planet full',
  cannot_dismantle_hq: 'Rejected: Cannot dismantle Command Hub or HQ',
  unknown_task: 'Rejected: Order no longer in the queue',
  goal_limit: 'Rejected: Goal limit reached',
  unknown_goal: 'Rejected: Goal no longer in the queue',
  timeout: 'Not confirmed: Timeout',
  not_connected: 'Not connected',
};

/** Kind-specific wording where the generic text would mislead. */
export const REJECT_TEXT_BY_KIND: Readonly<Record<string, Partial<Record<ToastRejectCode, string>>>> = {
  placeBuilding: { invalid_args: 'Rejected: Invalid placement', worker_tier_locked: 'Rejected: Requires a free HQ' },
  enqueueTask: { invalid_args: 'Rejected: Invalid terraform order', queue_full: 'Rejected: Terraform queue full' },
  moveUnit: { invalid_args: 'Rejected: Invalid move order' },
  stopUnit: { invalid_args: 'Rejected: Invalid stop order' },
};

function isToastCode(code: string): code is ToastRejectCode {
  return Object.prototype.hasOwnProperty.call(REJECT_TEXT, code);
}

/**
 * Toast text of a reject: the kind's wording where it has one, else the code's; unknown codes show the host's detail.
 * No shortfall numbers: the sim never rejects for cost (an unaffordable Hub is accepted and waits, GP-30), the order's
 * own waiting reason says what it waits for.
 */
export function formatRejectToast(code: string, detail?: string, kind?: string): string {
  if (isToastCode(code)) return (kind ? REJECT_TEXT_BY_KIND[kind]?.[code] : undefined) ?? REJECT_TEXT[code];
  if (detail) return `Rejected: ${detail}`;
  const clean = code.replace(/_/g, ' ');
  return `Rejected: ${clean.charAt(0).toUpperCase() + clean.slice(1)}`;
}
