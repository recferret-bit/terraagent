import { z } from 'zod';

/** `cmd.reject` codes (PROTOCOL §4.3) plus `wave_disabled` (PRODUCT_WAVES §3) and `host_unavailable` (D-31 local host). */
export const REJECT_CODES = [
  'invalid_args', 'unknown_kind', 'not_own_colony', 'colony_inactive', 'not_own_territory', 'site_blocked',
  'terrain_unbuildable', 'insufficient_resources', 'supply_cap', 'tier_locked', 'worker_tier_locked', 'stage_locked',
  'no_trade_hub', 'raid_protected', 'truce_active', 'would_isolate', 'launch_gate', 'mint_cap', 'market_unavailable',
  'planet_ended', 'wave_disabled', 'host_unavailable', 'internal',
] as const;
export const RejectCode = z.enum(REJECT_CODES);
export type RejectCode = z.infer<typeof RejectCode>;

/** WebSocket close codes (PROTOCOL §4.6). */
export const CLOSE_CODES = {
  going_away: 1001,
  too_big: 1009,
  bad_hello: 4000,
  replaced: 4001,
  forbidden: 4003,
  planet_ended: 4010,
  colony_eliminated: 4011,
  server_restarting: 4012,
} as const;
export type CloseName = keyof typeof CLOSE_CODES;
export const CloseCode = z.union(Object.values(CLOSE_CODES).map((c) => z.literal(c)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]);
export type CloseCode = (typeof CLOSE_CODES)[CloseName];

/** Close codes after which the client must not auto-reconnect (CLIENT §6.3). */
export const TERMINAL_CLOSE_CODES: readonly number[] = [CLOSE_CODES.replaced, CLOSE_CODES.planet_ended, CLOSE_CODES.colony_eliminated];

/** REST error envelope codes (PROTOCOL §8). */
export const REST_ERROR_CODES = [
  'validation_error', 'unauthorized', 'forbidden', 'not_found', 'already_queued', 'has_live_colony',
  'planet_not_recruiting', 'queue_full', 'near_unavailable', 'internal',
] as const;
export const RestErrorCode = z.enum(REST_ERROR_CODES);
