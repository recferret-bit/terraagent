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
  // W05 dismantle (owner bug "my drone self-dismantled"): dismantle is a worker action on a finished own building. A
  // unit (drone) or the worker itself cannot be dismantled, a building still under construction is cancelled instead,
  // the landed pod is only scrapped with a worker next to it.
  'cannot_dismantle_unit', 'cannot_dismantle_self', 'dismantle_unfinished', 'no_worker_in_reach',
  // W05 terraform: the hex is already Living (end of the growth ladder), the hex already has a queued or running
  // terraform job, or the op would change nothing (the hex is already in the op's target state)
  'already_terraformed', 'already_queued', 'already_at_target',
  // W08 HQ goals: goal queue is full for the colony's HQ tier (2 / 3 / 5); `cancelGoal` / `reorderGoal` names no open goal
  'goal_limit', 'unknown_goal',
  // W10 cargo & trade hub: insufficient stock/cargo, storage full on import, or Trade Hub offline
  'insufficient_stock', 'insufficient_cargo', 'storage_full', 'hub_offline',
  // W13 markets: stall fee outside the policy range, open-order limit reached, below lot / minimum notional, no such open
  // order of the colony (`no_trade_hub`, `hub_offline`, `insufficient_cargo`, `market_unavailable` are reused)
  'fee_out_of_range', 'order_limit', 'order_too_small', 'unknown_order',
  // W09 away policy (AW-22): an automated command the away rules refuse. Player commands are exempt.
  'away_policy',
  // W18 PvP & Diplomacy (UO-DIP-01..06, UO-T-05, W18-01, W18-31):
  'recent_hostility', 'oathbreaker', 'cross_sector_disabled', 'no_contact', 'truce_cap', 'unknown_offer', 'unknown_truce',
  // W22 clear_nest: a second bounty.post from the same colony in the same tick reuses `bt:{colony}:{tick}`.
  'already_posted',
  // W22-19: the nest is missing, dead, or outside the poster's explored tiles.
  'invalid_target',
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
  // W11 persistent worlds & sector admission (MATCHMAKING §0):
  'unsupported_mode', 'ticket_open', 'already_has_colony', 'planet_paused', 'planet_faulted', 'planet_archived',
  'sector_full', 'invalid_sector', 'too_late', 'party_full', 'same_planet_transfer', 'flag_incompatible',
  // W20 colony deed & staking (NEAR §6, §9):
  'deed_not_found', 'deed_not_settled', 'account_not_claimed', 'pool_not_whitelisted', 'stake_insufficient_balance',
  'DEED_NOT_FOUND', 'DEED_NOT_SETTLED', 'ACCOUNT_NOT_CLAIMED', 'POOL_NOT_WHITELISTED', 'STAKE_INSUFFICIENT_BALANCE',
  // W22 planet treasury (NEAR §10):
  'dao_not_found', 'not_a_member', 'already_voted', 'treasury_insufficient', 'proposal_closed',
  'DAO_NOT_FOUND', 'NOT_A_MEMBER', 'ALREADY_VOTED', 'TREASURY_INSUFFICIENT', 'PROPOSAL_CLOSED',
  // W22-19 bounty post:
  'invalid_target', 'insufficient_cargo', 'not_own_territory',
  // generic fallbacks by status when the domain code has no REST code of its own (BE-17): 409, 503, 413, 429
  'conflict', 'unavailable', 'payload_too_large', 'rate_limited',
] as const;
export const RestErrorCode = z.enum(REST_ERROR_CODES);
