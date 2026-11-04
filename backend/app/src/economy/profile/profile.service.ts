import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  checkProfileContent, economyError, ProfilePatch, type EconomyError, type ParamValue, type ProfileContent,
} from '@terra/contracts';
import { EconomyProfileRepository, EconomyRepoError, withTransaction, type DbClient, type ExportedVersion } from '@terra/db';
import type { PrismaClient } from '@prisma/client';
import { defaultParamRegistry, describeSchema, resolveRegion, tryCompileProfile, validatePatch, validateRegionContent, type CompiledProfile, type ResolveRegionResult } from '@terra/sim';
import { CoreException } from '../../core/errors';
import { persistenceEnabled } from '../../core/persistence';
import { APP_ENV, type AppEnv } from '../../core/tokens';
import { PRISMA } from '../../db/db.module';
import { FlagsService } from '../../flags/flags.service';

export interface ProfileScope { readonly planetType?: string; readonly planetId?: string; readonly sectorArchetype?: string; readonly sectorId?: string }
export interface ScopeLayer { readonly scope: string; readonly versionId: string; readonly contentHash: string }
export interface ResolvedProfile extends CompiledProfile { readonly layers: readonly ScopeLayer[] }
/** What the host loaded at boot: an active version (`loaded`), the bundled bootstrap tables (`bootstrap`), or nothing it can trust (`unavailable`). */
export type ProfileLoadState = 'unknown' | 'loaded' | 'bootstrap' | 'unavailable';
export interface MutationMeta { readonly actor: string; readonly requestId: string }

/** Raised for failures a client can act on; mapped to 4xx with the structured errors in `details.errors`. */
export function economyException(errors: readonly EconomyError[], status = 422): CoreException {
  const conflict = errors.some((e) => e.code === 'version_conflict');
  return new CoreException(conflict ? 'VERSION_CONFLICT' : 'ECONOMY_INVALID', { status: conflict ? 409 : status, message: errors[0]?.message ?? 'invalid economy request', details: { errors } });
}

/** Scope keys, most general first: global → planet type → planet id → sector archetype → sector id (ECONOMY §2.2). */
export const scopeChain = (s: ProfileScope): string[] => [
  'global',
  ...(s.planetType ? [`planetType:${s.planetType}`] : []),
  ...(s.planetId ? [`planet:${s.planetId}`] : []),
  ...(s.sectorArchetype ? [`sectorArchetype:${s.sectorArchetype}`] : []),
  ...(s.sectorId ? [`sector:${s.sectorId}`] : []),
];

/**
 * Profile management (ECONOMY §5, W13-38): clone / patch / validate / export on top of `EconomyProfileRepository`, and the
 * immutable compiled snapshot a host receives. Sim ticks never call this: planets get the plain compiled overrides object.
 */
@Injectable()
export class EconomyProfileService {
  private readonly log = new Logger('EconomyProfileService');
  private readonly repo: EconomyProfileRepository;
  private readonly compiledCache = new Map<string, ResolvedProfile>();
  private readonly versionCache = new Map<string, ExportedVersion>();
  private readonly versionCompiled = new Map<string, CompiledProfile>();
  private state: ProfileLoadState = 'unknown';

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, @Inject(APP_ENV) private readonly env: AppEnv, private readonly flags: FlagsService) {
    const reg = defaultParamRegistry();
    this.repo = new EconomyProfileRepository(prisma, (path) => reg.get(path)?.unit ?? 'unknown');
  }

  schema() { return describeSchema(this.flags.flags); }

  async list() {
    const profiles = await this.prisma.economyProfile.findMany({ orderBy: { name: 'asc' }, include: { versions: { orderBy: { version: 'asc' }, select: { version: true, status: true, contentHash: true, revision: true, parentId: true } } } });
    return profiles.map((p) => ({ id: p.id, name: p.name, description: p.description, currentVersion: p.currentVersion, draftVersion: p.draftVersion, versions: p.versions }));
  }

  async versions(profileId: string) {
    const rows = await this.prisma.economyProfileVersion.findMany({ where: { profileId }, orderBy: { version: 'asc' } });
    if (rows.length === 0 && !(await this.prisma.economyProfile.findUnique({ where: { id: profileId } }))) throw new CoreException('NOT_FOUND', { status: 404, message: `profile ${profileId} not found` });
    return rows.map((v) => ({ id: v.id, version: v.version, status: v.status, parentId: v.parentId, contentHash: v.contentHash, revision: v.revision, author: v.author, rationale: v.rationale }));
  }

  async get(profileId: string, version: number): Promise<ExportedVersion> {
    const v = await this.prisma.economyProfileVersion.findUnique({ where: { profileId_version: { profileId, version } }, select: { id: true } });
    if (!v) throw new CoreException('NOT_FOUND', { status: 404, message: `profile ${profileId} version ${version} not found` });
    return this.repo.exportVersion(v.id);
  }

  /** The portable W13-36 `ProfileContent` JSON of a version with its ref (profile id, version, content hash). */
  async export(profileId: string, version: number): Promise<{ ref: ExportedVersion['ref']; content: ProfileContent }> {
    const v = await this.get(profileId, version);
    return { ref: v.ref, content: v.content };
  }

  clone(profileId: string, version: number, meta: MutationMeta & { rationale?: string }): Promise<{ replayed: boolean; version: ExportedVersion }> {
    return this.mutate(meta, 'clone', async (tx) => {
      const src = await this.get(profileId, version);
      const next = await this.repo.cloneVersion(src.version.id, { author: meta.actor, rationale: meta.rationale ?? `clone of ${profileId}@${version}` }, tx);
      return { out: next, versionId: next.version.id, diff: { from: src.version.id, to: next.version.id } };
    });
  }

  /**
   * Applies a `ProfilePatch` to a DRAFT. `patch.expectedVersion` is the draft's `revision` the editor last saw (the
   * profile version number is in the URL). Registry validation runs first; a stale revision is `version_conflict`.
   */
  patch(profileId: string, version: number, rawPatch: unknown, actor: string): Promise<{ replayed: boolean; version: ExportedVersion }> {
    const parsed = ProfilePatch.safeParse(rawPatch);
    if (!parsed.success) throw economyException(validatePatch({}, rawPatch, this.flags.flags));
    const patch = parsed.data;
    return this.mutate({ actor, requestId: patch.requestId }, 'patch', async (tx) => {
      const cur = await this.get(profileId, version);
      const errors = validatePatch(cur.content, patch, this.flags.flags, { currentVersion: cur.revision });
      if (errors.length > 0) throw economyException(errors);
      const next = await this.repo.patchDraft(cur.version.id, patch.expectedVersion, patch.ops, tx);
      return { out: next, versionId: next.version.id, diff: { ops: patch.ops, revision: [cur.revision, next.revision] } };
    });
  }

  /** Registry + coverage + compile checks; a clean DRAFT becomes VALIDATED. Errors leave the draft untouched. */
  async validate(profileId: string, version: number, meta: MutationMeta): Promise<{ valid: boolean; errors: EconomyError[]; version: ExportedVersion; replayed?: boolean }> {
    const cur = await this.get(profileId, version);
    const errors = this.checkContent(cur.content);
    if (errors.length > 0 || cur.version.status !== 'DRAFT') return { valid: errors.length === 0, errors, version: cur };
    const done = await this.mutate(meta, 'validate', async (tx) => {
      const next = await this.repo.markValidated(cur.version.id, tx);
      return { out: next, versionId: next.version.id, diff: { status: ['DRAFT', 'VALIDATED'], contentHash: next.version.contentHash } };
    });
    return { valid: true, errors: [], version: done.version, replayed: done.replayed };
  }

  checkContent(content: ProfileContent): EconomyError[] {
    const errors: EconomyError[] = [...checkProfileContent(content), ...validateRegionContent(content.regions, content.logistics)];
    const compiled = tryCompileProfile(content, this.flags.list);
    if (!compiled.ok) errors.push(...compiled.errors);
    for (const [path, v] of Object.entries(content.parameters)) {
      if (typeof v === 'number' && !Number.isSafeInteger(v)) errors.push(economyError('wrong_type', 'integer safety: not a safe integer', path));
    }
    return errors;
  }

  /** Active versions per scope level (global → planet type → planet id), most general first; the resolver is extensible per level. */
  async resolve(scope: ProfileScope): Promise<ScopeLayer[]> {
    const layers: ScopeLayer[] = [];
    for (const key of scopeChain(scope)) {
      const act = await this.prisma.economyActivation.findFirst({ where: { scope: key, state: 'ACTIVE' }, include: { version: { select: { contentHash: true } } } });
      if (act) layers.push({ scope: key, versionId: act.versionId, contentHash: act.version.contentHash });
    }
    return layers;
  }

  /**
   * The immutable compiled snapshot for a scope: layers merged field by field (later scope wins), compiled once per chain
   * of version hashes and cached. Returns a plain frozen object; planets/threads get it, never a DB handle.
   */
  async compiledFor(scope: ProfileScope): Promise<ResolvedProfile> {
    const layers = await this.resolve(scope);
    const key = `${this.flags.flags.spec}|${layers.map((l) => `${l.versionId}:${l.contentHash}`).join('>')}`;
    const hit = this.compiledCache.get(key);
    if (hit) return hit;
    const parameters: Record<string, ParamValue> = {};
    for (const l of layers) Object.assign(parameters, (await this.immutableVersion(l.versionId)).content.parameters);
    const r = tryCompileProfile({ parameters }, this.flags.list);
    if (!r.ok) throw economyException(r.errors);
    const resolved: ResolvedProfile = Object.freeze({ ...r.compiled, layers: Object.freeze(layers) });
    this.compiledCache.set(key, resolved);
    return resolved;
  }

  /**
   * The effective regional endowment of a sector/planet with per-field provenance and the endowment/runtime hashes. Parameters merge
   * field by field across the active scope layers (as `compiledFor`); the region bindings and profiles come from the most specific
   * active layer that defines any (bindings of different versions are never concatenated, so a layer cannot create an ambiguity).
   */
  async regionFor(scope: ProfileScope): Promise<ResolveRegionResult> {
    const layers = await this.resolve(scope);
    const parameters: Record<string, ParamValue> = {};
    let regions: ProfileContent['regions'] = { profiles: [], bindings: [] };
    for (const l of layers) {
      const c = (await this.immutableVersion(l.versionId)).content;
      Object.assign(parameters, c.parameters);
      if (c.regions.profiles.length > 0 || c.regions.bindings.length > 0) regions = c.regions;
    }
    return resolveRegion({ parameters, regions }, { planetType: scope.planetType ?? '', planetId: scope.planetId ?? '', sectorArchetype: scope.sectorArchetype, sectorId: scope.sectorId });
  }

  /**
   * The overrides for the sim thread pool at boot: `{}` without persistence or without an active global version. A
   * database failure keeps the bundled tables but marks the profile `unavailable`, so cash actions fail closed
   * (`cashAvailable`) until a version loads; a missing version in production is `unavailable` as well (cold start).
   */
  async bootOverrides(): Promise<CompiledProfile['overrides']> {
    if (!persistenceEnabled(this.env as Parameters<typeof persistenceEnabled>[0])) { this.state = 'bootstrap'; return {}; }
    try {
      const c = await this.compiledFor({});
      if (c.layers.length > 0) { this.state = 'loaded'; return c.overrides; }
      this.state = this.env.NODE_ENV === 'production' ? 'unavailable' : 'bootstrap';
      return {};
    } catch (e) {
      if (e instanceof CoreException) throw e; // an active version that does not compile is a hard stop
      this.state = 'unavailable';
      this.log.error(`economy: active profile unavailable (${e instanceof Error ? e.message : String(e)}); booting on bootstrap data tables, cash actions fail closed`);
      return {};
    }
  }

  get loadState(): ProfileLoadState { return this.state; }
  /** Cash actions (market commands) need a loadable pinned version; only `unavailable` blocks them. */
  cashAvailable(): boolean { return this.state !== 'unavailable'; }
  /** Called by the host bridge once an activation is applied or the database became reachable again. */
  markLoaded(): void { this.state = 'loaded'; }

  /** Compiled snapshot of one immutable version (cached per content hash and flags); throws `ECONOMY_INVALID` when it does not compile. */
  async compileVersion(versionId: string): Promise<CompiledProfile> {
    const v = await this.immutableVersion(versionId);
    const key = `${this.flags.flags.spec}|${v.version.contentHash}`;
    const hit = this.versionCompiled.get(key);
    if (hit) return hit;
    const r = tryCompileProfile(v.content, this.flags.list);
    if (!r.ok) throw economyException(r.errors);
    this.versionCompiled.set(key, r.compiled);
    return r.compiled;
  }

  /** Operator decision: VALIDATED → APPROVED (activate role, audited, idempotent on `requestId`). */
  async approve(profileId: string, version: number, meta: MutationMeta): Promise<{ replayed: boolean; version: ExportedVersion }> {
    const cur = await this.get(profileId, version);
    return this.mutate(meta, 'approve', async (tx) => {
      const next = await this.repo.markApproved(cur.version.id, tx);
      return { out: next, versionId: next.version.id, diff: { status: [cur.version.status, 'APPROVED'] } };
    });
  }

  private async immutableVersion(versionId: string): Promise<ExportedVersion> {
    const hit = this.versionCache.get(versionId);
    if (hit) return hit;
    const v = await this.repo.exportVersion(versionId);
    if (v.version.status !== 'DRAFT') this.versionCache.set(versionId, v);
    return v;
  }

  /** One audited mutation: idempotent on `requestId` (a replay returns the stored result, nothing is applied twice). */
  private async mutate<T extends ExportedVersion>(meta: MutationMeta, action: string, fn: (tx: DbClient) => Promise<{ out: T; versionId: string; diff: object }>): Promise<{ replayed: boolean; version: T }> {
    const prior = await this.prisma.economyAuditEvent.findUnique({ where: { requestId: meta.requestId } });
    if (prior?.versionId) return { replayed: true, version: (await this.repo.exportVersion(prior.versionId)) as T };
    try {
      return await withTransaction(this.prisma, async (tx) => {
        const r = await fn(tx);
        const fresh = await this.repo.recordAudit({ actor: meta.actor, action, versionId: r.versionId, requestId: meta.requestId, diff: JSON.parse(JSON.stringify(r.diff)) }, tx);
        if (!fresh) throw new ReplayRace();
        return { replayed: false, version: r.out };
      });
    } catch (e) {
      if (e instanceof ReplayRace) {
        const again = await this.prisma.economyAuditEvent.findUnique({ where: { requestId: meta.requestId } });
        if (again?.versionId) return { replayed: true, version: (await this.repo.exportVersion(again.versionId)) as T };
      }
      if (e instanceof EconomyRepoError) throw economyException([e.error]);
      throw e;
    }
  }
}

class ReplayRace extends Error {}
