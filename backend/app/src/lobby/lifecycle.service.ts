import { Inject, Injectable } from '@nestjs/common';
import type { SectorId } from '@terra/contracts';
import {
  assertValidHealthState,
  assertValidLifecycleTransition,
  buildSectorStatusSnapshot,
  buildWorldStatusSnapshot,
  canTransitionWorldLifecycle,
  deriveSectorOccupancy,
  deriveWorldAvailability,
  isValidLifecycleState,
  requireAuditActorAndReason,
} from './lifecycle-policy.helpers';
import {
  AuditMetadataRequiredError,
  ConcurrencyConflictError,
  InvalidLifecycleTransitionError,
  type AdmissionEligibilityResult,
  type ElapsedAgeEvaluationResult,
  type MarkWorldProvisionedInput,
  type PauseResumePlanetAdmissionInput,
  type QueuePauseStatus,
  type SectorStatusSnapshot,
  type SetQueuePausedInput,
  type TransitionWorldLifecycleInput,
  type UpdateWorldHealthInput,
  type WorldAdmissionAuditEntry,
  type WorldStatusSnapshot,
} from './lifecycle.types';
import { LobbyPersistenceService } from './lobby-persistence.service';
import { LobbyPersistenceConflictError } from './lobby-persistence.types';
import {
  buildTransitionEntry,
  createAuditEntry,
  evaluateAdmissionEligibility,
  normalizeQueuePauseInput,
  toElapsedAgeResult,
} from './parts/lifecycle-ops';

export {
  AuditMetadataRequiredError,
  assertValidHealthState,
  assertValidLifecycleTransition,
  canTransitionWorldLifecycle,
  ConcurrencyConflictError,
  deriveSectorOccupancy,
  deriveWorldAvailability,
  InvalidLifecycleTransitionError,
};
export * from './lifecycle.types';

/**
 * Persistent world lifecycle & admission policy service (W11-03, MATCHMAKING §0.2, §0.3):
 * - Enforces explicit lifecycle state machine (`PROVISIONING -> ACTIVE -> ARCHIVED`), rejecting legacy `SEALED`
 *   and prohibiting automatic age-based sealing, lifetime expiry, or extinction/settlement endings.
 * - Derives `full` availability dynamically from validated safe landing slots (`freeSeats === 0`) without mutating
 *   `lifecycle` (`ACTIVE`) or `admission` (`OPEN`); releasing/expiring 1 reservation immediately restores `open`.
 * - Enforces audited operator `pausePlanetAdmission` / `resumePlanetAdmission` / `setQueuePaused` with required
 *   `actor` + `reason` and optimistic concurrency (`expectedUpdatedAt` -> HTTP 409 `ConcurrencyConflictError`).
 * - After a successful admission pause or archive commit, asks the game module for a SEAL or END snapshot (SIM-H-06).
 */
@Injectable()
export class WorldLifecycleService {
  private readonly auditLog: WorldAdmissionAuditEntry[] = [];
  private queuePaused = false;
  private queueUpdatedAt: Date = new Date(0);
  /** SIM-H-06: pause → SEAL, archive commit → END. Unset when the game module is not wired. */
  private savePoint?: (planetId: string, kind: 'SEAL' | 'END') => Promise<void>;

  setSnapshotSavePoint(fn: ((planetId: string, kind: 'SEAL' | 'END') => Promise<void>) | undefined): void {
    this.savePoint = fn;
  }

  constructor(@Inject(LobbyPersistenceService) private readonly persistence: LobbyPersistenceService) {}

  isQueuePaused(): boolean {
    return this.queuePaused;
  }

  getAuditLog(planetId?: string): readonly WorldAdmissionAuditEntry[] {
    if (planetId === undefined) {
      return [...this.auditLog];
    }
    return this.auditLog.filter((e) => e.planetId === planetId);
  }

  async getWorldStatus(planetId: string): Promise<WorldStatusSnapshot> {
    const world = await this.persistence.getCanonicalWorldById(planetId);
    if (!world) {
      throw new LobbyPersistenceConflictError('planet_not_found', `planet "${planetId}" not found`, {
        planetId,
      });
    }
    const sectors = await this.persistence.listSectors(planetId);
    return buildWorldStatusSnapshot(world, sectors);
  }

  async getSectorStatus(planetId: string, sectorId: SectorId): Promise<SectorStatusSnapshot> {
    const world = await this.persistence.getCanonicalWorldById(planetId);
    if (!world) {
      throw new LobbyPersistenceConflictError('planet_not_found', `planet "${planetId}" not found`, {
        planetId,
      });
    }
    const sector = await this.persistence.getSector(planetId, sectorId);
    if (!sector) {
      throw new LobbyPersistenceConflictError(
        'sector_not_found',
        `sector "${sectorId}" on planet "${planetId}" not found`,
        { planetId, sectorId },
      );
    }
    return buildSectorStatusSnapshot(world, sector);
  }

  async listWorldStatuses(): Promise<WorldStatusSnapshot[]> {
    const worlds = await this.persistence.listCanonicalWorlds();
    return Promise.all(
      worlds.map(async (world) => {
        const sectors = await this.persistence.listSectors(world.id);
        return buildWorldStatusSnapshot(world, sectors);
      }),
    );
  }

  /**
   * Pure/transactional admission eligibility check used by ticket enqueue and the matchmaker.
   * Reports `'open'` vs `'full' | 'paused' | 'faulted' | 'archived' | 'ocean_sector'`.
   */
  checkAdmissionEligibility(
    planetId: string,
    sectorId?: SectorId,
  ): Promise<AdmissionEligibilityResult> {
    return evaluateAdmissionEligibility(
      planetId,
      sectorId,
      this.queuePaused,
      (id) => this.getWorldStatus(id),
      (id, secId) => this.getSectorStatus(id, secId),
    );
  }

  /**
   * Operator action: pauses new founding reservations on a canonical planet while preserving
   * existing held reservations and founded colonies (MM-06).
   */
  async pausePlanetAdmission(input: PauseResumePlanetAdmissionInput): Promise<WorldStatusSnapshot> {
    const { actor, reason } = requireAuditActorAndReason(input.actor, input.reason, 'PAUSE');
    let recordedAudit: WorldAdmissionAuditEntry | undefined;

    const updated = await this.persistence.updateCanonicalWorldState({
      planetId: input.planetId,
      admission: 'PAUSED',
      expectedUpdatedAt: input.expectedUpdatedAt,
      now: input.now,
      onTransition: (prev, next) => {
        recordedAudit = this.appendAuditEntry(buildTransitionEntry(prev, next, 'PAUSE', actor, reason));
      },
    });

    const sectors = await this.persistence.listSectors(updated.id);
    await this.savePoint?.(updated.id, 'SEAL');
    return buildWorldStatusSnapshot(updated, sectors, recordedAudit);
  }

  /**
   * Operator action: resumes founding admission on a canonical planet (`admission: 'OPEN'`).
   */
  async resumePlanetAdmission(input: PauseResumePlanetAdmissionInput): Promise<WorldStatusSnapshot> {
    const { actor, reason } = requireAuditActorAndReason(input.actor, input.reason, 'RESUME');
    let recordedAudit: WorldAdmissionAuditEntry | undefined;

    const updated = await this.persistence.updateCanonicalWorldState({
      planetId: input.planetId,
      admission: 'OPEN',
      expectedUpdatedAt: input.expectedUpdatedAt,
      now: input.now,
      onTransition: (prev, next) => {
        recordedAudit = this.appendAuditEntry(buildTransitionEntry(prev, next, 'RESUME', actor, reason));
      },
    });

    const sectors = await this.persistence.listSectors(updated.id);
    return buildWorldStatusSnapshot(updated, sectors, recordedAudit);
  }

  /**
   * Operator action: pauses or resumes global matchmaking queue processing (MM-46, MM-49).
   */
  async setQueuePaused(input: SetQueuePausedInput): Promise<QueuePauseStatus> {
    const action = input.paused ? 'QUEUE_PAUSE' : 'QUEUE_RESUME';
    const { actor, reason } = requireAuditActorAndReason(input.actor, input.reason, action);
    const prevPaused = this.queuePaused;
    const baseNow = input.now ?? new Date();
    this.queueUpdatedAt = new Date(Math.max(baseNow.getTime(), this.queueUpdatedAt.getTime() + 1));
    this.queuePaused = input.paused;

    const auditEntry = this.appendAuditEntry({
      planetId: null,
      action,
      fromAdmission: prevPaused ? 'PAUSED' : 'OPEN',
      toAdmission: input.paused ? 'PAUSED' : 'OPEN',
      actor,
      reason,
      at: this.queueUpdatedAt.toISOString(),
    });

    return {
      queuePaused: this.queuePaused,
      updatedAt: this.queueUpdatedAt.toISOString(),
      auditEntry,
    };
  }

  /**
   * Operator convenience action: pauses global matchmaking queue processing (MM-46, MM-49).
   */
  pauseQueue(
    inputOrActor?: Partial<Omit<SetQueuePausedInput, 'paused'>> | string,
    reason?: string,
  ): Promise<QueuePauseStatus> {
    return this.setQueuePaused(normalizeQueuePauseInput(true, 'queue paused by operator', inputOrActor, reason));
  }

  /**
   * Operator convenience action: resumes global matchmaking queue processing (MM-46, MM-49).
   */
  resumeQueue(
    inputOrActor?: Partial<Omit<SetQueuePausedInput, 'paused'>> | string,
    reason?: string,
  ): Promise<QueuePauseStatus> {
    return this.setQueuePaused(normalizeQueuePauseInput(false, 'queue resumed by operator', inputOrActor, reason));
  }

  /**
   * Updates a canonical world's health (`OK`, `LOADING`, `RETRYING`, `FAULTED`) with optimistic concurrency.
   * Non-`OK` health derives `'faulted'` availability without altering `lifecycle` or `admission`.
   */
  async updateWorldHealth(input: UpdateWorldHealthInput): Promise<WorldStatusSnapshot> {
    const targetHealth = assertValidHealthState(input.health, input.planetId);
    const actor = input.actor?.trim() || 'system:health';
    const reason =
      input.reason?.trim() ||
      (input.faultCode ? `health->${targetHealth} (${input.faultCode})` : `health->${targetHealth}`);
    const nextFaultCode =
      input.faultCode !== undefined ? input.faultCode : targetHealth === 'OK' ? null : undefined;

    let recordedAudit: WorldAdmissionAuditEntry | undefined;
    const updated = await this.persistence.updateCanonicalWorldState({
      planetId: input.planetId,
      health: targetHealth,
      ...(nextFaultCode !== undefined ? { faultCode: nextFaultCode } : {}),
      ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
      ...(input.placementAttempts !== undefined ? { placementAttempts: input.placementAttempts } : {}),
      expectedUpdatedAt: input.expectedUpdatedAt,
      now: input.now,
      onTransition: (prev, next) => {
        recordedAudit = this.appendAuditEntry(buildTransitionEntry(prev, next, 'HEALTH_CHANGE', actor, reason));
      },
    });

    const sectors = await this.persistence.listSectors(updated.id);
    return buildWorldStatusSnapshot(updated, sectors, recordedAudit);
  }

  /**
   * Transitions a canonical world's lifecycle (`PROVISIONING -> ACTIVE -> ARCHIVED`) with optimistic concurrency.
   * Rejects any invalid transition (`ARCHIVED -> ACTIVE`, `ARCHIVED -> PROVISIONING`, `ACTIVE -> PROVISIONING`, or legacy `SEALED`).
   */
  async transitionWorldLifecycle(input: TransitionWorldLifecycleInput): Promise<WorldStatusSnapshot> {
    const rawTarget = String(input.toLifecycle ?? input.lifecycle ?? input.to ?? '');
    if (!isValidLifecycleState(rawTarget)) {
      assertValidLifecycleTransition('ACTIVE', rawTarget, input.planetId);
    }
    const targetLifecycle = rawTarget as 'PROVISIONING' | 'ACTIVE' | 'ARCHIVED';
    const actor = input.actor?.trim() || 'system:lifecycle';
    const reason = input.reason?.trim() || `lifecycle->${targetLifecycle}`;

    let recordedAudit: WorldAdmissionAuditEntry | undefined;
    const updated = await this.persistence.updateCanonicalWorldState({
      planetId: input.planetId,
      lifecycle: targetLifecycle,
      ...(input.health !== undefined ? { health: input.health } : {}),
      ...(targetLifecycle === 'ARCHIVED'
        ? { admission: 'ARCHIVED' }
        : input.admission !== undefined
          ? { admission: input.admission }
          : {}),
      ...(input.faultCode !== undefined ? { faultCode: input.faultCode } : {}),
      ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
      ...(input.placementAttempts !== undefined ? { placementAttempts: input.placementAttempts } : {}),
      expectedUpdatedAt: input.expectedUpdatedAt,
      now: input.now,
      onTransition: (prev, next) => {
        const action = targetLifecycle === 'ARCHIVED' ? 'ARCHIVE' : 'LIFECYCLE_CHANGE';
        recordedAudit = this.appendAuditEntry(buildTransitionEntry(prev, next, action, actor, reason));
      },
    });

    // After the row commits: an END snapshot written first would make `livePlanetIds` skip a planet whose archive then failed.
    if (targetLifecycle === 'ARCHIVED') await this.savePoint?.(updated.id, 'END');
    const sectors = await this.persistence.listSectors(updated.id);
    return buildWorldStatusSnapshot(updated, sectors, recordedAudit);
  }

  /**
   * Marks a canonical world as provisioned and healthy on its sim thread (`PROVISIONING -> ACTIVE`, `health: 'OK'`, `faultCode: null`).
   */
  async markProvisioned(input: MarkWorldProvisionedInput | string): Promise<WorldStatusSnapshot> {
    const normalized: MarkWorldProvisionedInput =
      typeof input === 'string' ? { planetId: input } : input;
    return this.transitionWorldLifecycle({
      planetId: normalized.planetId,
      toLifecycle: 'ACTIVE',
      health: 'OK',
      faultCode: null,
      retryCount: normalized.retryCount,
      placementAttempts: normalized.placementAttempts,
      actor: normalized.actor ?? 'system:provisioning',
      reason: normalized.reason ?? 'canonical world loaded onto sim thread',
      expectedUpdatedAt: normalized.expectedUpdatedAt,
      now: normalized.now,
    });
  }

  /**
   * Explicit audited admin archival (`ACTIVE | PROVISIONING -> ARCHIVED`).
   * Requires non-empty `actor` and `reason`.
   */
  async archiveWorld(input: PauseResumePlanetAdmissionInput): Promise<WorldStatusSnapshot> {
    const { actor, reason } = requireAuditActorAndReason(input.actor, input.reason, 'ARCHIVE');
    return this.transitionWorldLifecycle({
      planetId: input.planetId,
      toLifecycle: 'ARCHIVED',
      actor,
      reason,
      expectedUpdatedAt: input.expectedUpdatedAt,
      now: input.now,
    });
  }

  /**
   * Evaluates elapsed world age (`72h`, `7d`, `30d`, etc.) for a canonical world.
   * Persistent canonical worlds NEVER seal, close admission, or archive due to elapsed age,
   * colony extinction, or settlement (MATCHMAKING §0.2 MM-03/04/07/08).
   */
  async evaluateElapsedAge(planetId: string, elapsedMs: number): Promise<ElapsedAgeEvaluationResult> {
    const snapshot = await this.getWorldStatus(planetId);
    return toElapsedAgeResult(snapshot, elapsedMs);
  }

  /**
   * Sweeps all canonical worlds at wall-clock or simulation time `now`.
   * Guarantees that advancing time by 24h, 72h, 7d, 14d, or 30d never seals or archives any canonical world.
   */
  async sweepLifecycleForElapsedTime(
    now: Date | number = new Date(),
  ): Promise<readonly ElapsedAgeEvaluationResult[]> {
    const targetMs = now instanceof Date ? now.getTime() : now;
    const worlds = await this.persistence.listCanonicalWorlds();
    return Promise.all(
      worlds.map((world) => {
        const elapsedMs = Math.max(0, targetMs - world.createdAt.getTime());
        return this.evaluateElapsedAge(world.id, elapsedMs);
      }),
    );
  }

  private appendAuditEntry(
    entry: Omit<WorldAdmissionAuditEntry, 'id'>,
  ): WorldAdmissionAuditEntry {
    const fullEntry = createAuditEntry(entry);
    this.auditLog.push(fullEntry);
    return fullEntry;
  }
}
