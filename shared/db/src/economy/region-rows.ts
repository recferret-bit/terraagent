import {
  LogisticsContent, RegionsContent, RESOURCE_FIELDS, RESOURCE_KEYS,
  type LogisticsContent as Logistics, type RegionResourceFields, type RegionsContent as Regions, type ResourceKey,
} from '@terra/contracts';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../repository';

const byKey = <T>(key: (t: T) => string) => (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const big = (n: number | undefined): bigint | null => (n === undefined ? null : BigInt(n));
/** Drops null/undefined keys so the parsed content has no `key: undefined` (canonical JSON would print it). */
const compact = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

/** Column name of each registered field on `economy.region_resource` (the contract field name is the Prisma field name). */
const BIGINT_FIELDS: ReadonlySet<string> = new Set(['reserveUnitsMin', 'reserveUnitsMax', 'starterGuarantee', 'renewableUnitsPerSimHour']);

/** Replaces the region/scope/logistics rows of a DRAFT version (child-row triggers reject other statuses). */
export async function writeRegionRows(db: DbClient, versionId: string, content: { regions: Regions; logistics: Logistics }): Promise<void> {
  await db.economyScopeBinding.deleteMany({ where: { versionId } });
  await db.economyRegionResource.deleteMany({ where: { versionId } });
  await db.economyRegionProfile.deleteMany({ where: { versionId } });
  await db.economyLogisticsPolicy.deleteMany({ where: { versionId } });
  const { profiles, bindings } = content.regions;
  await db.economyRegionProfile.createMany({
    data: profiles.map((p) => ({
      versionId, regionProfileId: p.regionProfileId, sectorArchetype: p.sectorArchetype ?? '',
      depositDensityPer1000Tiles: p.depositDensityPer1000Tiles ?? null, mainResource: p.mainResource ?? null,
    })),
  });
  await db.economyRegionResource.createMany({
    data: profiles.flatMap((p) =>
      (Object.entries(p.resources) as [ResourceKey, RegionResourceFields][]).map(([resourceKey, f]) => ({
        versionId, regionProfileId: p.regionProfileId, resourceKey,
        occurrenceWeightBp: f.occurrenceWeightBp ?? null, reserveUnitsMin: big(f.reserveUnitsMin), reserveUnitsMax: big(f.reserveUnitsMax),
        terraformFindWeightBp: f.terraformFindWeightBp ?? null, starterGuarantee: big(f.starterGuarantee),
        extractionYieldBp: f.extractionYieldBp ?? null, renewableUnitsPerSimHour: big(f.renewableUnitsPerSimHour),
      }))),
  });
  await db.economyScopeBinding.createMany({
    data: bindings.map((b) => ({ versionId, scopeKind: b.scopeKind, planetType: b.planetType, planetId: b.planetId, sectorId: b.sectorId, archetype: b.archetype, priority: b.priority, regionProfileId: b.regionProfileId })),
  });
  await db.economyLogisticsPolicy.createMany({
    data: content.logistics.entries.map((e) => ({
      versionId, kind: e.kind, subjectId: e.subjectId, tier: e.tier, loadWeightMilli: BigInt(e.loadWeightMilli), throughputMilli: big(e.throughputMilli ?? undefined),
      reachTiles: e.reachTiles, baseConsumption: e.baseConsumption as Prisma.InputJsonValue,
    })),
  });
}

export async function readRegions(db: DbClient, versionId: string): Promise<Regions> {
  const [profiles, resources, bindings] = await Promise.all([
    db.economyRegionProfile.findMany({ where: { versionId } }),
    db.economyRegionResource.findMany({ where: { versionId } }),
    db.economyScopeBinding.findMany({ where: { versionId } }),
  ]);
  return normalizeRegions(RegionsContent.parse({
    profiles: profiles.map((p) => compact({
      regionProfileId: p.regionProfileId, sectorArchetype: p.sectorArchetype === '' ? null : p.sectorArchetype,
      depositDensityPer1000Tiles: p.depositDensityPer1000Tiles, mainResource: p.mainResource,
      resources: Object.fromEntries(resources.filter((r) => r.regionProfileId === p.regionProfileId).map((r) => [r.resourceKey, resourceFields(r)])),
    })),
    bindings: bindings.map((b) => ({ scopeKind: b.scopeKind, planetType: b.planetType, planetId: b.planetId, sectorId: b.sectorId, archetype: b.archetype, priority: b.priority, regionProfileId: b.regionProfileId })),
  }));
}

function resourceFields(r: Prisma.EconomyRegionResourceGetPayload<object>): RegionResourceFields {
  const out: Record<string, number> = {};
  for (const f of RESOURCE_FIELDS) {
    const v = (r as unknown as Record<string, unknown>)[f];
    if (v === null || v === undefined) continue;
    out[f] = BIGINT_FIELDS.has(f) ? Number(v as bigint) : (v as number);
  }
  return out as RegionResourceFields;
}

export async function readLogistics(db: DbClient, versionId: string): Promise<Logistics> {
  const rows = await db.economyLogisticsPolicy.findMany({ where: { versionId } });
  return normalizeLogistics(LogisticsContent.parse({
    entries: rows.map((r) => ({
      kind: r.kind, subjectId: r.subjectId, tier: r.tier, loadWeightMilli: Number(r.loadWeightMilli), throughputMilli: r.throughputMilli === null ? null : Number(r.throughputMilli),
      reachTiles: r.reachTiles, baseConsumption: r.baseConsumption,
    })),
  }));
}

/** Canonical order (profiles by id, resources in ResourceKey order, bindings by scope key then priority) so hashes match after a round-trip. */
export function normalizeRegions(r: Regions): Regions {
  const order = (k: string) => RESOURCE_KEYS.indexOf(k as ResourceKey);
  return {
    profiles: [...r.profiles].sort(byKey((p) => p.regionProfileId)).map((p) => ({
      ...p,
      resources: Object.fromEntries(Object.entries(p.resources).sort(([a], [b]) => order(a) - order(b))) as Regions['profiles'][number]['resources'],
    })),
    bindings: [...r.bindings].sort(byKey((b) => [b.scopeKind, b.planetType, b.planetId, b.sectorId, b.archetype, String(b.priority).padStart(5, '0')].join('\u0000'))),
  };
}

export function normalizeLogistics(l: Logistics): Logistics {
  return { entries: [...l.entries].sort(byKey((e) => `${e.kind}\u0000${e.subjectId}\u0000${String(e.tier).padStart(3, '0')}`)) };
}
