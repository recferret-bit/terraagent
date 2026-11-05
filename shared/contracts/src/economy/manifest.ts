import { z } from 'zod';
import { parseWaves } from '../flags';
import { AtomicAmount } from '../market/tokens';
import { EconomyProfileRef } from './profile';
import { economyError, zodIssuesToEconomyErrors, type EconomyError } from './errors';

export const MANIFEST_SCHEMA_VERSION = 1;

const Tick = z.number().int().nonnegative();
const Id = z.string().min(1);
const Hash = z.string().min(1);

/** `..13` / `all` / `00,01,13`, validated by the wave-flag parser (a typo never turns a wave on silently). */
const WavesSpec = z.string().refine((s) => {
  try { parseWaves(s); return true; } catch { return false; }
}, 'expected a wave spec like "..13", "all" or "00,13"');

export const ScenarioRef = z.strictObject({ id: Id, version: z.number().int().positive() });
export type ScenarioRef = z.infer<typeof ScenarioRef>;

/** ECONOMY §6 manifest. Integer amounts are decimal strings. §9 hashes are optional. */
const ExperimentManifestShape = z.strictObject({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  profile: EconomyProfileRef,
  engineCommit: Id,
  waves: WavesSpec,
  scenarios: z.array(ScenarioRef).min(1),
  seeds: z.array(z.number().int()).min(1),
  /** Independent held-out seeds (ECONOMY §6): run like `seeds`, never used to tune; a recommendation must hold on them too. Disjoint from `seeds`. */
  heldOutSeeds: z.array(z.number().int()).optional(),
  warmupTicks: Tick,
  measureTicks: Tick.refine((n) => n > 0, 'measureTicks must be positive'),
  sampleEveryTicks: z.number().int().positive(),
  ticksPerSecond: z.number().int().positive(),
  budget: z.strictObject({
    maxRuns: z.number().int().positive(),
    maxWallSeconds: z.number().int().positive(),
    maxWorkers: z.number().int().positive(),
  }),
  behaviorProfile: Id,
  demandModel: z.strictObject({
    source: Id,
    perPayingActorMonthlyBudgetUsdcAtomic: AtomicAmount,
  }),
  output: z.strictObject({
    format: z.enum(['json', 'jsonl', 'csv']),
    trace: z.enum(['none', 'failures', 'all']),
  }),
  // §9 (optional): pinned region/logistics inputs and population/base/army distributions.
  regionBindingsHash: Hash.optional(),
  endowmentHash: Hash.optional(),
  runtimeEconomyHash: Hash.optional(),
  logisticsPolicyHash: Hash.optional(),
  distributions: z.record(z.string(), z.unknown()).optional(),
});
export const ExperimentManifest = ExperimentManifestShape.refine(
  (m) => !(m.heldOutSeeds ?? []).some((s) => m.seeds.includes(s)),
  { message: 'heldOutSeeds must be disjoint from seeds', path: ['heldOutSeeds'] },
);
export type ExperimentManifest = z.infer<typeof ExperimentManifestShape>;

export const ScenarioShock = z.strictObject({ kind: Id, atTick: Tick, params: z.record(z.string(), z.unknown()).default({}) });
export const ScenarioPopulation = z.strictObject({ cohort: Id, colonies: z.number().int().nonnegative(), params: z.record(z.string(), z.unknown()).default({}) });

/** A versioned, immutable scenario (seeds-independent): populations, shocks and assumptions (`economy.scenario`). */
export const ScenarioManifest = z.strictObject({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  id: Id,
  version: z.number().int().positive(),
  description: z.string().default(''),
  waves: WavesSpec,
  populations: z.array(ScenarioPopulation),
  shocks: z.array(ScenarioShock).default([]),
  assumptions: z.record(z.string(), z.unknown()).default({}),
  hash: Hash.optional(),
});
export type ScenarioManifest = z.infer<typeof ScenarioManifest>;

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: EconomyError[] };

function parseWith<T>(schema: z.ZodType<T>, input: unknown, what: string): ParseResult<T> {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const errors = zodIssuesToEconomyErrors(r.error, 'invalid_manifest');
  return { ok: false, errors: errors.length ? errors : [economyError('invalid_manifest', `${what} is invalid`)] };
}

/** Parses an experiment manifest into a value or structured `invalid_manifest` errors (CLI exit 2). */
export const parseExperimentManifest = (input: unknown): ParseResult<ExperimentManifest> => parseWith(ExperimentManifest, input, 'experiment manifest');
export const parseScenarioManifest = (input: unknown): ParseResult<ScenarioManifest> => parseWith(ScenarioManifest, input, 'scenario manifest');
