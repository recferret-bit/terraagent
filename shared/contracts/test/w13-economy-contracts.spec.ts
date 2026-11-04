import { describe, expect, it } from 'vitest';
import {
  ECONOMY_EXIT_CODES,
  EXPERIMENT_STATUSES,
  EconomyError,
  ExperimentStatus,
  GateResult,
  MetricRow,
  ProfileContent,
  ProfilePatch,
  ProfileVersion,
  checkProfileContent,
  economyExitCode,
  parseExperimentManifest,
  parseScenarioManifest,
  RESOURCE_KEYS,
  type ProfileContent as Content,
} from '../src';

/** The ECONOMY §6 manifest example, verbatim. */
const SECTION_6 = {
  schemaVersion: 1,
  profile: { id: 'candidate-a', version: 2, hash: 'sha256:...' },
  engineCommit: '<git-sha>',
  waves: '..13',
  scenarios: [{ id: 'mature-flat-population', version: 1 }],
  seeds: [101, 202, 303],
  warmupTicks: 432000,
  measureTicks: 12960000,
  sampleEveryTicks: 18000,
  ticksPerSecond: 5,
  budget: { maxRuns: 12, maxWallSeconds: 1800, maxWorkers: 2 },
  behaviorProfile: 'specialists-v1',
  demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' },
  output: { format: 'jsonl', trace: 'failures' },
};

describe('W13-36 economy contracts', () => {
  it('parses the ECONOMY §6 manifest example, with the §9 hashes optional', () => {
    const r = parseExperimentManifest(SECTION_6);
    expect(r.ok).toBe(true);
    const withHashes = parseExperimentManifest({ ...SECTION_6, regionBindingsHash: 'sha256:a', endowmentHash: 'sha256:b', runtimeEconomyHash: 'sha256:c', logisticsPolicyHash: 'sha256:d' });
    expect(withHashes.ok).toBe(true);
  });

  it('rejects an invalid manifest with structured invalid_manifest errors', () => {
    const bad = parseExperimentManifest({ ...SECTION_6, seeds: [], waves: 'soon', demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30.5' }, extra: 1 });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.every((e) => e.code === 'invalid_manifest')).toBe(true);
    const paths = bad.errors.map((e) => e.path);
    expect(paths).toContain('seeds');
    expect(paths).toContain('waves');
    expect(paths).toContain('demandModel.perPayingActorMonthlyBudgetUsdcAtomic');
    for (const e of bad.errors) expect(EconomyError.safeParse(e).success).toBe(true);
  });

  it('parses a scenario manifest', () => {
    const r = parseScenarioManifest({ schemaVersion: 1, id: 'mature-flat-population', version: 1, waves: '..13', populations: [{ cohort: 'specialists', colonies: 40 }], shocks: [{ kind: 'buyerBudgetHalved', atTick: 100 }] });
    expect(r.ok).toBe(true);
  });

  it('profile version, patch, status, gate and metric DTOs', () => {
    const v = { id: 'pv_1', profileId: 'candidate-a', version: 2, parentId: 'pv_0', status: 'DRAFT', schemaVersion: 1, engineCompatibility: '>=1', contentHash: 'sha256:abc', author: 'ai', rationale: 'test' };
    expect(ProfileVersion.safeParse(v).success).toBe(true);
    expect(ProfileVersion.safeParse({ ...v, status: 'LIVE' }).success).toBe(false);
    expect(ProfilePatch.safeParse({ schemaVersion: 1, requestId: 'r1', expectedVersion: 2, ops: [{ op: 'set', path: 'market.policy.platformFeeBp', value: 80 }, { op: 'unset', path: 'x' }] }).success).toBe(true);
    expect(ProfilePatch.safeParse({ schemaVersion: 2, requestId: 'r1', expectedVersion: 2, ops: [] }).success).toBe(false);
    expect(EXPERIMENT_STATUSES).toEqual(['queued', 'running', 'completed', 'failed', 'cancelled', 'incomplete']);
    expect(ExperimentStatus.safeParse('incomplete').success).toBe(true);
    for (const outcome of ['pass', 'fail', 'insufficient_data']) {
      expect(GateResult.safeParse({ gateId: 'fill-ratio', gateVersion: 1, outcome, observed: null, threshold: '8000' }).success).toBe(true);
    }
    const m = { window: { startTick: 0, endTick: 18000 }, scope: 'planet:dune', resource: 'bio.water', metricKey: 'inventory_days', value: null, reason: 'zero_demand', unit: 'days' };
    expect(MetricRow.safeParse(m).success).toBe(true);
    expect(MetricRow.safeParse({ ...m, reason: undefined }).success).toBe(false);
    expect(MetricRow.safeParse({ ...m, value: '1.5', reason: undefined }).success).toBe(true);
  });

  it('exit codes follow ECONOMY §6 (0/2/3/4)', () => {
    expect(ECONOMY_EXIT_CODES).toEqual({ ok: 0, invalidInput: 2, failedGates: 3, executionFailure: 4 });
    expect(economyExitCode({})).toBe(0);
    expect(economyExitCode({ errors: [{ code: 'unknown_path', message: 'x' }] })).toBe(2);
    expect(economyExitCode({ failedGates: 1 })).toBe(3);
    expect(economyExitCode({ crashed: true, failedGates: 1 })).toBe(4);
  });

  it('profile content defaults, and resource coverage is checked for all ten keys', () => {
    const empty: Content = ProfileContent.parse({});
    expect(empty.recipes).toEqual([]);
    const codes = checkProfileContent(empty).map((e) => e.code);
    expect(codes.filter((c) => c === 'missing_resource_coverage')).toHaveLength(10);
    const policies = RESOURCE_KEYS.map((resource) => ({ resource, sources: ['harvester'], consumers: ['build'], producerCohorts: ['miners'], buyerCohorts: ['builders'], reserveHorizonTicks: 100, targetBand: { loBp: 1000, hiBp: 8000 } }));
    const full = ProfileContent.parse({ resourcePolicies: policies, recipes: [{ recipeId: 'prestige-1', activityKind: 'project', durationTicks: 100, eligibility: ['hub'], inputs: { 'metals.t3': '50' }, output: { kind: 'fact', factId: 'prestige' }, enabledWave: 'W13' }] });
    expect(checkProfileContent(full)).toEqual([]);
    expect(ProfileContent.safeParse({ recipes: [{ recipeId: 'r', activityKind: 'a', durationTicks: 1, eligibility: [], inputs: { gold: '1' }, output: { kind: 'fact', factId: 'f' }, enabledWave: 'W13' }] }).success).toBe(false);
    const broken = ProfileContent.parse({ resourcePolicies: policies.map((p, i) => (i === 0 ? { ...p, sources: [] } : p)) });
    expect(checkProfileContent(broken)[0]).toMatchObject({ code: 'missing_resource_coverage', path: 'resourcePolicies.metals.t1' });
  });
});
