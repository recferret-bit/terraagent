import { z } from 'zod';
import { ResourceKey } from '../ws/sim';

/**
 * Planet/sector resource endowments and logistics policy rows (ECONOMY §2.2, §2.3, §5; W13-50). A `RegionProfileDef` holds
 * PARTIAL per-resource fields: an omitted field inherits from the layer below, an explicit `0` is a deliberate value.
 * `ScopeBindingDef` attaches a profile to a scope level of the resolution order
 * global -> planetType -> planetId -> sectorArchetype -> sectorId.
 */
export const SCOPE_KINDS = ['planetType', 'planetId', 'sectorArchetype', 'sectorId'] as const;
export const ScopeKind = z.enum(SCOPE_KINDS);
export type ScopeKind = z.infer<typeof ScopeKind>;
/** Resolution order, most general first; `global` is the registered default layer and has no binding row. */
export const SCOPE_LEVELS = ['global', ...SCOPE_KINDS] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

/** Fixed at world creation (new-world only): changing them needs a value-preserving migration for an existing world. */
export const ENDOWMENT_FIELDS = ['occurrenceWeightBp', 'reserveUnitsMin', 'reserveUnitsMax', 'terraformFindWeightBp', 'starterGuarantee'] as const;
/** Operational (future production windows): tunable through audited runtime activation. */
export const RUNTIME_FIELDS = ['extractionYieldBp', 'renewableUnitsPerSimHour'] as const;
export const RESOURCE_FIELDS = [...ENDOWMENT_FIELDS, ...RUNTIME_FIELDS] as const;
export type ResourceField = (typeof RESOURCE_FIELDS)[number];

const Whole = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Bp = z.number().int().min(0).max(1_000_000);

/** Partial per-resource endowment/yield fields; every field optional (omitted = inherit). */
export const RegionResourceFields = z.strictObject({
  occurrenceWeightBp: Bp.optional(),
  reserveUnitsMin: Whole.optional(),
  reserveUnitsMax: Whole.optional(),
  terraformFindWeightBp: Bp.optional(),
  /** Whole units of bounded starter reserve this resource guarantees near the landing site (essential T1 access). */
  starterGuarantee: Whole.optional(),
  extractionYieldBp: Bp.optional(),
  renewableUnitsPerSimHour: Whole.optional(),
});
export type RegionResourceFields = z.infer<typeof RegionResourceFields>;

export const RegionProfileDef = z.strictObject({
  regionProfileId: z.string().min(1).max(64),
  /** Free label of the sector archetype this profile describes (`crystal-ridge`); bindings do the matching. */
  sectorArchetype: z.string().max(64).optional(),
  /** Deposits per 1000 tiles of the sector, set once per sector profile. */
  depositDensityPer1000Tiles: Whole.optional(),
  /** Display intent; must match measured expected recoverable output (validated by the resolver). */
  mainResource: ResourceKey.optional(),
  resources: z.partialRecord(ResourceKey, RegionResourceFields).default({}),
});
export type RegionProfileDef = z.infer<typeof RegionProfileDef>;

export const ScopeBindingDef = z.strictObject({
  scopeKind: ScopeKind,
  /** Non-empty scope columns must ALL equal the request context for the binding to match; kind decides which is required. */
  planetType: z.string().max(60).default(''),
  planetId: z.string().max(64).default(''),
  sectorId: z.string().max(64).default(''),
  archetype: z.string().max(64).default(''),
  regionProfileId: z.string().min(1).max(64),
  /** Within one level the highest priority wins; equal priorities that both match are an ambiguous binding. */
  priority: z.number().int().min(0).max(1000).default(0),
});
export type ScopeBindingDef = z.infer<typeof ScopeBindingDef>;

export const RegionsContent = z.strictObject({
  profiles: z.array(RegionProfileDef).default([]),
  bindings: z.array(ScopeBindingDef).default([]),
});
export type RegionsContent = z.infer<typeof RegionsContent>;

export const LOGISTICS_KINDS = ['building', 'unit', 'node'] as const;
export const LogisticsKind = z.enum(LOGISTICS_KINDS);
export type LogisticsKind = z.infer<typeof LogisticsKind>;

/**
 * One logistics row: a building / unit / supply-node kind at a tier. Loads and throughput are integers in thousandths of
 * a logistics-load unit; nodes carry throughput and service reach (tiles), others do not. Base consumption is whole units
 * of each resource per supply window. Coefficients (alpha, beta, ...) are registered parameters, not rows.
 */
export const LogisticsEntry = z.strictObject({
  kind: LogisticsKind,
  subjectId: z.string().min(1).max(80),
  tier: z.number().int().min(0).max(10).default(1),
  loadWeightMilli: Whole,
  throughputMilli: Whole.nullable().default(null),
  reachTiles: Whole.nullable().default(null),
  baseConsumption: z.partialRecord(ResourceKey, Whole).default({}),
});
export type LogisticsEntry = z.infer<typeof LogisticsEntry>;

export const LogisticsContent = z.strictObject({ entries: z.array(LogisticsEntry).default([]) });
export type LogisticsContent = z.infer<typeof LogisticsContent>;
