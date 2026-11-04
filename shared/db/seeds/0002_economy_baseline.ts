import { RESOURCE_KEYS, type ProfileContent } from '@terra/contracts';
import { TICKS_PER_SECOND, defaultParamRegistry } from '@terra/sim';
import market from '../../sim/src/data/market';
import type { SeedContext } from '../scripts/seed';
import { EconomyProfileRepository, contentHashOf, normalizeContent } from '../src/economy';

const PROFILE_ID = 'baseline';
const SCOPE = 'global';

/** Baseline content from the bootstrap data tables: every registered default, the ten resource policies, USDC pair policies. */
export function baselineContent(): ProfileContent {
  const reg = defaultParamRegistry();
  const row = (id: string) => {
    const r = market.rows.find((x) => x.id === id);
    if (!r) throw new Error(`market data row ${id} is missing`);
    return r as Record<string, unknown>;
  };
  const policy = row('policy');
  const usdc = row('quote.USDC');
  return normalizeContent({
    parameters: reg.defaults(),
    resourcePolicies: RESOURCE_KEYS.map((resource) => {
      const r = row(`resource.${resource}`);
      return {
        resource,
        // Bootstrap placeholders until the W13 recipe/flow issues replace them with real source/consumer ids.
        sources: ['bootstrap.production'], consumers: ['bootstrap.construction'], producerCohorts: ['bootstrap.producers'], buyerCohorts: ['bootstrap.builders'],
        reserveHorizonTicks: (r.reserveHorizonS as number) * TICKS_PER_SECOND,
        targetBand: { loBp: r.targetBandLoBp as number, hiBp: r.targetBandHiBp as number },
      };
    }),
    marketPolicies: RESOURCE_KEYS.map((resource) => {
      const r = row(`resource.${resource}`);
      return {
        pairId: `${resource}/USDC`, tokenMetadataRef: 'USDC', platformFeeBp: policy.platformFeeBp, stallFeeBp: policy.stallFeeDefaultBp,
        lotUnits: String(r.lotUnits), tickAtomic: usdc.tickAtomic, minNotionalAtomic: usdc.minNotionalAtomic, treasuryShareBp: policy.treasuryShareBp,
      };
    }),
  });
}

/** Idempotent: `baseline` v1 (APPROVED) from the bootstrap tables plus an ACTIVE global activation when none exists. */
export default async function seed({ prisma, log }: SeedContext): Promise<void> {
  const reg = defaultParamRegistry();
  const repo = new EconomyProfileRepository(prisma, (path) => reg.get(path)?.unit ?? 'unknown');
  const existing = await prisma.economyProfileVersion.findUnique({ where: { id: `${PROFILE_ID}@1` } });
  if (existing) {
    log(`baseline v1 already present (${existing.status}, ${existing.contentHash})`);
  } else {
    await prisma.economyProfile.upsert({ where: { id: PROFILE_ID }, update: {}, create: { id: PROFILE_ID, name: PROFILE_ID, description: 'Bootstrap baseline from the shared/sim data tables' } });
    const draft = await repo.createVersion(PROFILE_ID, { author: 'seed', rationale: 'bootstrap data tables (W13-37)', content: baselineContent() });
    await repo.markValidated(draft.version.id);
    await repo.markApproved(draft.version.id);
    log(`created baseline v1 ${contentHashOf(baselineContent())}`);
  }
  const active = await prisma.economyActivation.findFirst({ where: { scope: SCOPE, state: 'ACTIVE' } });
  if (active) return log(`global activation already ACTIVE (${active.id})`);
  await prisma.economyActivation.create({
    data: { id: `act_${PROFILE_ID}_1`, scope: SCOPE, versionId: `${PROFILE_ID}@1`, state: 'ACTIVE', operator: 'seed', appliedTick: 0n, requestedTick: 0n },
  });
  log('activated baseline v1 globally');
}
