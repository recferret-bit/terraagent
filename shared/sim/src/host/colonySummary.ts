/**
 * Colony record fields only the colony's own player reads (HUD panels, planners, queues, AI advice). A client delta
 * sends them only to the colony's sockets (and to full viewers); every other field is the colony's "summary" that
 * every socket on the planet gets (identity, status, stage, combat / diplomacy state, power for entity lighting, …).
 *
 * A foreign colony on a client therefore holds these fields as of its welcome (never missing ones): prediction steps
 * the whole sim on the replica, so a record must stay complete. Add a field here only after checking that no
 * `frontend/game` code reads it for a colony other than the player's own.
 */
export const COLONY_OWNER_FIELDS: ReadonlySet<string> = new Set([
  // economy HUD (ResourcesHud, MinimalHud, catalogs, trade hub)
  'stock', 'caps', 'production', 'supply', 'supplyTrade', 'market', 'cargo', 'cargoCaps', 'earmarks', 'residual',
  'extractorBonuses', 'tierGates',
  // goals, priorities and AI advice panels
  'goals', 'goalLimit', 'priorities', 'aiEnabled', 'lastAutopilotDecision', 'activeSuggestion', 'suggestion',
  'nextStageConditionText',
  // own-only planners
  'terraformQueue', 'rallyPoint',
]);

export const isColonyOwnerField = (k: string): boolean => COLONY_OWNER_FIELDS.has(k);
