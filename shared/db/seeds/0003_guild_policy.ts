import type { ProfileContent } from '@terra/contracts';
import { TICKS_PER_SECOND, defaultParamRegistry } from '@terra/sim';
import guild from '../../sim/src/data/guild';
import type { SeedContext } from '../scripts/seed';
import { EconomyProfileRepository, contentHashOf, normalizeContent } from '../src/economy';
import { baselineContent } from './0002_economy_baseline';

const PROFILE_ID = 'guild';
const T1 = ['metals.t1', 'minerals.t1', 'bio.water', 'bio.biomass'] as const;
const TARGET: Record<(typeof T1)[number], string> = {
  'metals.t1': 'targetMetalsT1', 'minerals.t1': 'targetMineralsT1', 'bio.water': 'targetWater', 'bio.biomass': 'targetBiomass',
};
const YOCTO_PER_NEAR = 10n ** 24n;

const row = (id: string): Record<string, unknown> => {
  const found = guild.rows.find((r) => r.id === id);
  if (!found) throw new Error(`guild data row ${id} is missing`);
  return found;
};

/** `guild@1` content: baseline parameters (they name `guild-mock-1`) plus one agent policy per roster NPC. Cash stays 0. */
export function guildProfileContent(): ProfileContent {
  const policy = row('policy');
  const cap = String(policy.inventoryCapUnits);
  const cash = (BigInt(policy.npcNearFloatCap as number) * YOCTO_PER_NEAR).toString();
  const referenceWindowTicks = (policy.referenceMaxAgeS as number) * TICKS_PER_SECOND;
  const agentPolicies = (['kestrel', 'vanguard'] as const).map((id) => {
    const npc = row(id);
    const targets: Record<string, number> = {};
    const inventoryLimits: Record<string, string> = {};
    for (const pair of T1) {
      targets[pair] = npc[TARGET[pair]] as number;
      inventoryLimits[pair] = cap;
    }
    return {
      actorId: id, targets, cashLimitAtomic: cash, spendLimitAtomic: String(policy.dailySpendAtomic),
      lossLimitAtomic: String(policy.dailyLossAtomic), inventoryLimits, referenceWindowTicks,
    };
  });
  return normalizeContent({ ...baselineContent(), agentPolicies });
}

/**
 * Idempotent mock profile `guild` v1. Not activated: `baseline@1` stays the live market profile.
 * Real cash stays disabled (`guild.policy.cashEnabled` 0). A second run does not write a new version.
 */
export default async function seed({ prisma, log }: SeedContext): Promise<void> {
  const existing = await prisma.economyProfileVersion.findUnique({ where: { id: `${PROFILE_ID}@1` } });
  if (existing) return log(`guild v1 already present (${existing.status}, ${existing.contentHash})`);
  const content = guildProfileContent();
  await prisma.economyProfile.upsert({
    where: { id: PROFILE_ID }, update: {},
    create: { id: PROFILE_ID, name: 'Guild mock policy', description: 'W15-02 Guild roster and quote policy guild-mock-1. Real cash stays disabled.' },
  });
  const repo = new EconomyProfileRepository(prisma, (path) => defaultParamRegistry().get(path)?.unit ?? 'unknown');
  const draft = await repo.createVersion(PROFILE_ID, { author: 'seed', rationale: 'W15-02 guild-mock-1; cashEnabled 0', content });
  await repo.markValidated(draft.version.id);
  await repo.markApproved(draft.version.id);
  log(`created guild v1 ${contentHashOf(content)}`);
}
