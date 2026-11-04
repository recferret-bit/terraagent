import { z } from 'zod';

/** Authoritative trigger names (AI_ORCHESTRATOR §3). Player HTTP input cannot mint one of these. */
export const DIRECTOR_TRIGGERS = [
  'resource.critical',
  'resource.shortage',
  'storage.full',
  'supply.capped',
  'power.collapse',
  'hub.critical',
  'under_attack',
  'building.destroyed',
  'hazard.ended',
  'neighbor.contact',
  'trade.offer',
  'rocket.available',
  'away.started',
  'away.checkpoint',
  'player.intent_changed',
  'goal.blocked',
  'goal.completed',
  'diplomacy.truce_offered',
  'sector.threat',
  'sector.resource',
] as const;
export const DirectorTriggerSchema = z.enum(DIRECTOR_TRIGGERS);
export type DirectorTrigger = z.infer<typeof DirectorTriggerSchema>;
