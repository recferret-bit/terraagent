import { z } from 'zod';
import { ScopedId } from './ids';

export const SectorWeatherStateSchema = z.enum([
  'clear',
  'dust_storm',
  'solar_flare',
  'acid_rain',
  'seismic_tremor',
]);
export type SectorWeatherState = z.infer<typeof SectorWeatherStateSchema>;

export const SectorColonySnapSchema = z.strictObject({
  colonyId: ScopedId,
  isOffline: z.boolean(),
  offlineSinceSimS: z.number().nonnegative().optional(),
  hqTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  resources: z.record(z.string(), z.number()),
  powerDeficit: z.boolean(),
  threatScore: z.number().min(0).max(100),
  stewardshipMode: z.enum(['conservative', 'balanced', 'growth', 'lockdown']),
});
export type SectorColonySnap = z.infer<typeof SectorColonySnapSchema>;

export const SectorFaunaSnapSchema = z.strictObject({
  swarmId: z.string().min(1).max(64),
  species: z.enum(['blackAnt', 'blueBeetle', 'greenSpitter']),
  count: z.number().int().positive(),
  aggression: z.enum(['passive', 'territorial', 'swarming']),
  centerHex: z.strictObject({ q: z.number(), r: z.number() }),
  targetColonyId: ScopedId.optional(),
});
export type SectorFaunaSnap = z.infer<typeof SectorFaunaSnapSchema>;

export const SectorDisasterSnapSchema = z.strictObject({
  hazardId: z.string().min(1).max(64),
  type: SectorWeatherStateSchema,
  intensity: z.number().min(0).max(1),
  remainingDurationS: z.number().nonnegative(),
  affectedHexes: z.array(z.strictObject({ q: z.number(), r: z.number() })).max(16),
});
export type SectorDisasterSnap = z.infer<typeof SectorDisasterSnapSchema>;

export const SectorMarketSnapSchema = z.strictObject({
  highestDeficitResource: z.string().min(1).max(32).optional(),
  highestSurplusResource: z.string().min(1).max(32).optional(),
  activeTradeRoutes: z.number().int().nonnegative(),
});
export type SectorMarketSnap = z.infer<typeof SectorMarketSnapSchema>;

export const SectorDiplomacySnapSchema = z.strictObject({
  colonyPair: z.tuple([ScopedId, ScopedId]),
  relation: z.enum(['neutral', 'friendly', 'hostile', 'truce']),
  borderTension: z.number().min(0).max(100),
});
export type SectorDiplomacySnap = z.infer<typeof SectorDiplomacySnapSchema>;

export const SectorAdvisorBriefSchema = z.strictObject({
  version: z.literal(1),
  sectorId: ScopedId,
  planetId: ScopedId,
  simTimeS: z.number().nonnegative(),
  cadenceS: z.number().positive(),
  colonies: z.array(SectorColonySnapSchema).max(16),
  fauna: z.array(SectorFaunaSnapSchema).max(8),
  disasters: z.array(SectorDisasterSnapSchema).max(4),
  market: SectorMarketSnapSchema,
  diplomacy: z.array(SectorDiplomacySnapSchema).max(12),
});
export type SectorAdvisorBrief = z.infer<typeof SectorAdvisorBriefSchema>;

export const SectorAdvisorDirectiveSchema = z.strictObject({
  version: z.literal(1),
  sectorId: ScopedId,
  advisorRationale: z.string().max(400),
  stewardshipDirectives: z
    .array(
      z.strictObject({
        colonyId: ScopedId,
        action: z.enum(['fortify', 'expand_energy', 'stockpile_metals', 'retreat_to_shelter', 'hold']),
        priorityGoal: z.string().optional(),
        rationale: z.string().max(200),
      }),
    )
    .max(16),
  faunaManagement: z.strictObject({
    threatLevel: z.enum(['negligible', 'moderate', 'severe', 'apocalyptic']),
    containmentHex: z.strictObject({ q: z.number(), r: z.number() }).optional(),
    suggestedResponse: z.string().max(200),
  }),
  disasterAdvisory: z.strictObject({
    shelterProtocol: z.boolean(),
    powerGridLoadShedding: z.boolean(),
    advisoryText: z.string().max(200),
  }),
  tradeGuidance: z.strictObject({
    exportCommodity: z.string().optional(),
    importCommodity: z.string().optional(),
    routePriority: z.enum(['normal', 'expedited', 'embargo']),
  }),
});
export type SectorAdvisorDirective = z.infer<typeof SectorAdvisorDirectiveSchema>;
