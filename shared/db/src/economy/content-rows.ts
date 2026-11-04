import { ProfileContent, type ProfileContent as Content } from '@terra/contracts';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../repository';

type Json = Prisma.InputJsonValue;

/** Maps a path to its unit label for the `parameter.unit` column (the profile service passes the registry's unit). */
export type UnitOf = (path: string) => string;
export const unknownUnit: UnitOf = () => 'unknown';

const byKey = <T>(key: (t: T) => string) => (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/** Replaces every child row of a DRAFT version with `content` (the immutability triggers reject other statuses). */
export async function writeContent(db: DbClient, versionId: string, content: Content, unitOf: UnitOf = unknownUnit): Promise<void> {
  await db.economyParameter.deleteMany({ where: { versionId } });
  await db.economyRecipeInput.deleteMany({ where: { versionId } });
  await db.economyRecipe.deleteMany({ where: { versionId } });
  await db.economyResourcePolicy.deleteMany({ where: { versionId } });
  await db.economyMarketPolicy.deleteMany({ where: { versionId } });
  await db.economyAgentPolicy.deleteMany({ where: { versionId } });
  await db.economyParameter.createMany({
    data: Object.entries(content.parameters).map(([path, value]) => ({ versionId, path, value: value as Json, unit: unitOf(path) })),
  });
  await db.economyRecipe.createMany({
    data: content.recipes.map((r) => ({
      versionId, recipeId: r.recipeId, activityKind: r.activityKind, durationTicks: r.durationTicks,
      eligibility: r.eligibility as Json, output: r.output as Json, enabledWave: r.enabledWave,
    })),
  });
  await db.economyRecipeInput.createMany({
    data: content.recipes.flatMap((r) =>
      Object.entries(r.inputs).map(([resourceKey, amountAtomic]) => ({ versionId, recipeId: r.recipeId, resourceKey, amountAtomic: amountAtomic as string }))),
  });
  await db.economyResourcePolicy.createMany({
    data: content.resourcePolicies.map((p) => ({
      versionId, resourceKey: p.resource, sources: p.sources, consumers: p.consumers, producerCohorts: p.producerCohorts,
      buyerCohorts: p.buyerCohorts, reserveHorizonTicks: p.reserveHorizonTicks, targetLoBp: p.targetBand.loBp, targetHiBp: p.targetBand.hiBp,
    })),
  });
  await db.economyMarketPolicy.createMany({
    data: content.marketPolicies.map((m) => ({
      versionId, pairId: m.pairId, tokenMetadataRef: m.tokenMetadataRef, platformFeeBp: m.platformFeeBp, stallFeeBp: m.stallFeeBp,
      lotUnits: m.lotUnits, tickAtomic: m.tickAtomic, minNotionalAtomic: m.minNotionalAtomic, treasuryShareBp: m.treasuryShareBp,
    })),
  });
  await db.economyAgentPolicy.createMany({
    data: content.agentPolicies.map((a) => ({
      versionId, actorId: a.actorId, targets: a.targets as Json, cashLimitAtomic: a.cashLimitAtomic, spendLimitAtomic: a.spendLimitAtomic,
      lossLimitAtomic: a.lossLimitAtomic, inventoryLimits: a.inventoryLimits as Json, referenceWindowTicks: a.referenceWindowTicks,
    })),
  });
}

/** The W13-36 `ProfileContent` stored for `versionId`, in canonical order (parameters by path, rows by key). */
export async function readContent(db: DbClient, versionId: string, sections: { regions: unknown; logistics: unknown }): Promise<Content> {
  const [params, recipes, resources, markets, agents] = await Promise.all([
    db.economyParameter.findMany({ where: { versionId } }),
    db.economyRecipe.findMany({ where: { versionId }, include: { inputs: true } }),
    db.economyResourcePolicy.findMany({ where: { versionId } }),
    db.economyMarketPolicy.findMany({ where: { versionId } }),
    db.economyAgentPolicy.findMany({ where: { versionId } }),
  ]);
  return ProfileContent.parse({
    parameters: Object.fromEntries(params.sort(byKey((p) => p.path)).map((p) => [p.path, p.value])),
    recipes: recipes.sort(byKey((r) => r.recipeId)).map((r) => ({
      recipeId: r.recipeId, activityKind: r.activityKind, durationTicks: r.durationTicks, eligibility: r.eligibility, output: r.output,
      enabledWave: r.enabledWave,
      inputs: Object.fromEntries(r.inputs.map((i) => [i.resourceKey, i.amountAtomic.toFixed()])),
    })),
    resourcePolicies: resources.sort(byKey((p) => p.resourceKey)).map((p) => ({
      resource: p.resourceKey, sources: p.sources, consumers: p.consumers, producerCohorts: p.producerCohorts, buyerCohorts: p.buyerCohorts,
      reserveHorizonTicks: p.reserveHorizonTicks, targetBand: { loBp: p.targetLoBp, hiBp: p.targetHiBp },
    })),
    marketPolicies: markets.sort(byKey((m) => m.pairId)).map((m) => ({
      pairId: m.pairId, tokenMetadataRef: m.tokenMetadataRef, platformFeeBp: m.platformFeeBp, stallFeeBp: m.stallFeeBp,
      lotUnits: m.lotUnits.toFixed(), tickAtomic: m.tickAtomic.toFixed(), minNotionalAtomic: m.minNotionalAtomic.toFixed(), treasuryShareBp: m.treasuryShareBp,
    })),
    agentPolicies: agents.sort(byKey((a) => a.actorId)).map((a) => ({
      actorId: a.actorId, targets: a.targets, cashLimitAtomic: a.cashLimitAtomic.toFixed(), spendLimitAtomic: a.spendLimitAtomic.toFixed(),
      lossLimitAtomic: a.lossLimitAtomic.toFixed(), inventoryLimits: a.inventoryLimits, referenceWindowTicks: a.referenceWindowTicks,
    })),
    regions: sections.regions,
    logistics: sections.logistics,
  });
}

/** Content with its lists in the canonical order `readContent` returns (so a hash taken before storing equals one after). */
export function normalizeContent(content: unknown): Content {
  const c = ProfileContent.parse(content);
  const sorted = <T>(xs: readonly T[], key: (t: T) => string): T[] => [...xs].sort(byKey(key));
  return {
    ...c,
    recipes: sorted(c.recipes, (r) => r.recipeId),
    resourcePolicies: sorted(c.resourcePolicies, (p) => p.resource),
    marketPolicies: sorted(c.marketPolicies, (m) => m.pairId),
    agentPolicies: sorted(c.agentPolicies, (a) => a.actorId),
  };
}
