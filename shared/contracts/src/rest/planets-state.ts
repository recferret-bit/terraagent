import { z } from 'zod';
import { AgentDecisionFeedItemV1Schema, SimInputFeedItemV1Schema } from '../ws/feed';

export const SectorParticipantStateV1Schema = z.strictObject({
  id: z.string(),
  planetId: z.string(),
  sectorId: z.string(),
  colonyId: z.string(),
  colonyIndex: z.number().int().min(0),
  playerId: z.string().nullable(),
  actorKind: z.enum(['player', 'bot']),
  isBot: z.boolean(),
  handle: z.string(),
  botPersona: z.string().nullable(),
  status: z.string(),
  stage: z.number().int().min(0),
  aiEnabled: z.boolean(),
  alive: z.boolean(),
  hqQ: z.number().int().nullable(),
  hqR: z.number().int().nullable(),
  unitCount: z.number().int().min(0),
  buildingCount: z.number().int().min(0),
  stock: z.record(z.string(), z.number()),
  caps: z.record(z.string(), z.number()),
  power: z.record(z.string(), z.unknown()),
  queue: z.array(z.unknown()),
  goals: z.array(z.unknown()),
  entities: z.array(z.unknown()),
  lastInputAtTick: z.number().int().nullable(),
  lastTick: z.number().int().min(0),
  updatedAt: z.string(),
});
export type SectorParticipantStateV1 = z.infer<typeof SectorParticipantStateV1Schema>;

export const SectorLiveSummaryV1Schema = z.strictObject({
  planetId: z.string(),
  sectorId: z.string(),
  kind: z.string(),
  macroQ: z.number().int(),
  macroR: z.number().int(),
  centerQ: z.number().int(),
  centerR: z.number().int(),
  foundingCapacity: z.number().int().min(0),
  reservedSeats: z.number().int().min(0),
  foundedSeats: z.number().int().min(0),
  activeHumans: z.number().int().min(0),
  activeBots: z.number().int().min(0),
  lastSyncedTick: z.number().int().min(0),
  lastSyncedAt: z.string().nullable(),
  participants: z.array(SectorParticipantStateV1Schema),
});
export type SectorLiveSummaryV1 = z.infer<typeof SectorLiveSummaryV1Schema>;

export const PlanetSectorsLiveStateV1Schema = z.strictObject({
  planetId: z.string(),
  tick: z.number().int().min(0),
  sectors: z.array(SectorLiveSummaryV1Schema),
  participants: z.array(SectorParticipantStateV1Schema),
});
export type PlanetSectorsLiveStateV1 = z.infer<typeof PlanetSectorsLiveStateV1Schema>;

export const SimInputHistoryResponseV1Schema = z.strictObject({
  planetId: z.string(),
  items: z.array(SimInputFeedItemV1Schema),
  nextCursor: z.string().nullable(),
});
export type SimInputHistoryResponseV1 = z.infer<typeof SimInputHistoryResponseV1Schema>;

export const AgentDecisionHistoryResponseV1Schema = z.strictObject({
  planetId: z.string(),
  items: z.array(AgentDecisionFeedItemV1Schema),
  nextCursor: z.string().nullable(),
});
export type AgentDecisionHistoryResponseV1 = z.infer<typeof AgentDecisionHistoryResponseV1Schema>;
