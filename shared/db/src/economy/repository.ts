import {
  ProfilePatchOp,
  type EconomyProfileRef,
  type ProfileContent,
  type ProfileStatus,
  type ProfileVersion,
} from '@terra/contracts';
import { Prisma, type EconomyProfileVersion } from '@prisma/client';
import { RepositoryBase, type DbClient } from '../repository';
import { readContent, normalizeContent, unknownUnit, writeContent, type UnitOf } from './content-rows';
import { repoError } from './errors';
import { contentHashOf } from './hash';

export const ECONOMY_SCHEMA_VERSION = 1;
const ID = /^[a-z0-9][a-z0-9_.-]{0,47}$/;

export interface NewVersionMeta {
  readonly author: string;
  readonly rationale?: string;
  readonly engineCompatibility?: string;
  readonly parentId?: string | null;
  readonly content?: unknown;
}

export interface ExportedVersion { readonly ref: EconomyProfileRef; readonly version: ProfileVersion; readonly content: ProfileContent; readonly revision: number }

const toVersion = (v: EconomyProfileVersion): ProfileVersion => ({
  id: v.id, profileId: v.profileId, version: v.version, parentId: v.parentId, status: v.status as ProfileStatus, schemaVersion: v.schemaVersion,
  engineCompatibility: v.engineCompatibility, contentHash: v.contentHash, author: v.author, rationale: v.rationale, createdAt: v.createdAt.toISOString(),
});

/**
 * Economy profile storage (ECONOMY §5, W13-37): drafts are edited optimistically (`revision`), VALIDATED/APPROVED content
 * is immutable (DB triggers), clones copy children into a new DRAFT. Pure storage: validation against the parameter
 * registry and the activation state machine belong to the profile service (W13-38/39). Every method takes an optional `tx`.
 */
export class EconomyProfileRepository extends RepositoryBase {
  constructor(prisma: ConstructorParameters<typeof RepositoryBase>[0], private readonly unitOf: UnitOf = unknownUnit) { super(prisma); }

  async createProfile(input: { id: string; name: string; description?: string }, tx?: DbClient) {
    if (!ID.test(input.id)) throw repoError('invalid_manifest', `profile id "${input.id}" must match ${ID}`, 'id');
    return this.db(tx).economyProfile.create({ data: { id: input.id, name: input.name, description: input.description ?? '' } });
  }

  /** Creates the next DRAFT version of a profile (optionally with content). Serialised per profile. */
  createVersion(profileId: string, meta: NewVersionMeta, tx?: DbClient): Promise<ExportedVersion> {
    return this.tx(async (t) => {
      await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`economy.profile:${profileId}`}))`;
      const last = await t.economyProfileVersion.aggregate({ where: { profileId }, _max: { version: true } });
      const version = (last._max.version ?? 0) + 1;
      const content = normalizeContent(meta.content ?? {});
      const id = `${profileId}@${version}`;
      await t.economyProfileVersion.create({
        data: {
          id, profileId, version, parentId: meta.parentId ?? null, status: 'DRAFT', schemaVersion: ECONOMY_SCHEMA_VERSION,
          engineCompatibility: meta.engineCompatibility ?? '>=1', contentHash: contentHashOf(content), author: meta.author,
          rationale: meta.rationale ?? '',
        },
      });
      await writeContent(t, id, content, this.unitOf);
      await t.economyProfile.update({ where: { id: profileId }, data: { draftVersion: version } });
      return this.exportVersion(id, t);
    }, tx);
  }

  /** Imports W13-36 `ProfileContent` JSON as a new DRAFT (throws `invalid_manifest`-style zod errors via the contract). */
  importVersion(profileId: string, content: unknown, meta: Omit<NewVersionMeta, 'content'>, tx?: DbClient): Promise<ExportedVersion> {
    return this.createVersion(profileId, { ...meta, content }, tx);
  }

  /** Copies a version (any status) into a new DRAFT of the same profile, parent-linked. */
  async cloneVersion(versionId: string, meta: { author: string; rationale?: string }, tx?: DbClient): Promise<ExportedVersion> {
    const src = await this.exportVersion(versionId, tx);
    return this.createVersion(src.version.profileId, { ...meta, parentId: versionId, engineCompatibility: src.version.engineCompatibility, content: src.content }, tx);
  }

  /**
   * Replaces the content of a DRAFT if `expectedRevision` still matches (compare-and-swap on `revision`); otherwise
   * throws `version_conflict`. Concurrent writers serialise on the row lock, so exactly one wins.
   */
  replaceDraftContent(versionId: string, expectedRevision: number, content: unknown, tx?: DbClient): Promise<ExportedVersion> {
    return this.tx(async (t) => {
      const next = normalizeContent(content);
      const n = await t.$executeRaw`
        UPDATE "economy"."profile_version" SET "revision" = "revision" + 1, "content_hash" = ${contentHashOf(next)}
        WHERE "id" = ${versionId} AND "revision" = ${expectedRevision} AND "status" = 'DRAFT'`;
      if (n === 0) await this.throwNotUpdatable(t, versionId, expectedRevision);
      await writeContent(t, versionId, next, this.unitOf);
      return this.exportVersion(versionId, t);
    }, tx);
  }

  /** Applies registered-parameter `set`/`unset` ops to a DRAFT under the optimistic revision guard. */
  async patchDraft(versionId: string, expectedRevision: number, ops: readonly ProfilePatchOp[], tx?: DbClient): Promise<ExportedVersion> {
    return this.tx(async (t) => {
      const cur = await this.exportVersion(versionId, t);
      if (cur.revision !== expectedRevision) await this.throwNotUpdatable(t, versionId, expectedRevision);
      const parameters = { ...cur.content.parameters };
      for (const op of ops.map((o) => ProfilePatchOp.parse(o))) {
        if (op.op === 'unset') delete parameters[op.path];
        else if (op.value === undefined) throw repoError('wrong_type', 'a set op needs a value', op.path);
        else parameters[op.path] = op.value;
      }
      return this.replaceDraftContent(versionId, expectedRevision, { ...cur.content, parameters }, t);
    }, tx);
  }

  markValidated(versionId: string, tx?: DbClient): Promise<ExportedVersion> { return this.advance(versionId, 'DRAFT', 'VALIDATED', tx); }
  markApproved(versionId: string, tx?: DbClient): Promise<ExportedVersion> { return this.advance(versionId, 'VALIDATED', 'APPROVED', tx); }

  async exportVersion(versionId: string, tx?: DbClient): Promise<ExportedVersion> {
    const db = this.db(tx);
    const v = await db.economyProfileVersion.findUnique({ where: { id: versionId } });
    if (!v) throw repoError('version_conflict', `version ${versionId} does not exist`, undefined, { versionId });
    const content = await readContent(db, versionId);
    return { ref: { id: v.profileId, version: v.version, hash: v.contentHash }, version: toVersion(v), content, revision: v.revision };
  }

  /** Versions with this content hash (identical clones share a hash). */
  async findByContentHash(hash: string, tx?: DbClient): Promise<readonly ProfileVersion[]> {
    return (await this.db(tx).economyProfileVersion.findMany({ where: { contentHash: hash }, orderBy: { createdAt: 'asc' } })).map(toVersion);
  }

  /** Appends an audit row; returns false when `requestId` was already recorded (idempotent mutation). */
  async recordAudit(e: { actor: string; action: string; versionId?: string | null; requestId: string; diff?: Prisma.InputJsonValue }, tx?: DbClient): Promise<boolean> {
    const n = await this.db(tx).$executeRaw`
      INSERT INTO "economy"."audit_event" ("actor", "action", "version_id", "request_id", "diff")
      VALUES (${e.actor}, ${e.action}, ${e.versionId ?? null}, ${e.requestId}, ${JSON.stringify(e.diff ?? {})}::jsonb)
      ON CONFLICT ("request_id") DO NOTHING`;
    return n === 1;
  }

  private advance(versionId: string, from: ProfileStatus, to: ProfileStatus, tx?: DbClient): Promise<ExportedVersion> {
    return this.tx(async (t) => {
      const cur = await this.exportVersion(versionId, t);
      const stamp = to === 'VALIDATED' ? { validatedAt: new Date() } : { approvedAt: new Date() };
      if (contentHashOf(cur.content) !== cur.version.contentHash) throw repoError('schema_mismatch', 'stored content does not match its content hash', undefined, { versionId });
      const r = await t.economyProfileVersion.updateMany({ where: { id: versionId, status: from }, data: { status: to, ...stamp } });
      if (r.count === 0) throw repoError('version_conflict', `version ${versionId} is ${cur.version.status}, expected ${from}`, undefined, { versionId, status: cur.version.status });
      if (to === 'APPROVED') await t.economyProfile.update({ where: { id: cur.version.profileId }, data: { currentVersion: cur.version.version } });
      return this.exportVersion(versionId, t);
    }, tx);
  }

  private async throwNotUpdatable(db: DbClient, versionId: string, expected: number): Promise<never> {
    const v = await db.economyProfileVersion.findUnique({ where: { id: versionId }, select: { status: true, revision: true } });
    if (!v) throw repoError('version_conflict', `version ${versionId} does not exist`, undefined, { versionId });
    if (v.status !== 'DRAFT') throw repoError('version_conflict', `version ${versionId} is ${v.status} and immutable; clone it to edit`, undefined, { versionId, status: v.status });
    throw repoError('version_conflict', `version ${versionId} is at revision ${v.revision}, expected ${expected}`, undefined, { versionId, expected, current: v.revision });
  }
}
