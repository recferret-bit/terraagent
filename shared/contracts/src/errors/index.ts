import { z } from 'zod';

/** `cmd.reject` codes (PROTOCOL §4.3) plus `wave_disabled` (PRODUCT_WAVES §3) and `host_unavailable` (D-31 local host). */
export const REJECT_CODES = [
  'invalid_args', 'unknown_kind', 'not_own_colony', 'colony_inactive', 'not_own_territory', 'site_blocked',
  'terrain_unbuildable', 'insufficient_resources', 'supply_cap', 'unknown_entity', 'tier_locked', 'worker_tier_locked', 'stage_locked',
  'no_trade_hub', 'raid_protected', 'truce_active', 'would_isolate', 'launch_gate', 'mint_cap', 'market_unavailable',
  'planet_ended', 'wave_disabled', 'host_unavailable', 'internal',
  // too many commands from one player (server ingress token bucket, PROTOCOL §4.2)
  'rate_limited',
  // W01 landing: a colony lands once; no two colonies share a slot or land too close (`hq.startingKit.minLandingSeparation`)
  'already_landed', 'landing_site_taken',
  // W01 sim: the colony's terraform lane is full (`hq.t1.terraformMaxOrders` / `terraformMaxJobs`); the planet has no
  // room for another colony (8 per planet: one `explored` bit each)
  'queue_full', 'planet_full',
  // W02 dismantle: Command Hub and HQ Drone cannot be dismantled
  'cannot_dismantle_hq',
  // W02 queue: `cancelTask` / `reorderTask` names no open task of the colony
  'unknown_task',
  // W03 queue: lane has reached its capacity and no `auto` entry can be dropped
  'lane_full',
  // W03 grid: a building other than the Command Hub must stand inside the colony's power zone (Hub / Power Pylon reach)
  'outside_power_zone',
  // W03 dismantle: the building is already being dismantled (owner feedback W03 #6)
  'already_dismantling',
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
  // W01 `/me/home`: the new colony's landing was refused (409, `errorCode: COLONY_SEAT_REJECTED`, the reject code in `details.code`)
  'seat_rejected',
  // generic fallbacks by status when the domain code has no REST code of its own (BE-17): 409, 503, 413, 429
  'conflict', 'unavailable', 'payload_too_large', 'rate_limited',
] as const;
export const RestErrorCode = z.enum(REST_ERROR_CODES);
