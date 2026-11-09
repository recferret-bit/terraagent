import type {
  LandingSlotId,
  SectorId,
  SectorReservationV1,
  SimCommandV1,
} from '@terra/contracts';
import type { ColonyRecord, PlanetRecord } from '../core/home/home.repository';
import type { ColonySeatAssignment } from '../core/home/home.service';
import type { CommandOutcomeMsg } from '../game/game-planets.service';
import type {
  MatchTicketRecord,
  SectorReservationRecord,
} from './lobby-persistence.types';
import type { ManagedSectorReservationRecord } from './reservation.types';

/** DI token for an optional custom colony spawn/retire executor (`SpawnSagaService`). */
export const COLONY_SPAWN_EXECUTOR = Symbol('COLONY_SPAWN_EXECUTOR');

/** Default maximum spawn attempts per reservation within its TTL (`MM-37`: up to 3 attempts). */
export const DEFAULT_MAX_SPAWN_RETRIES_PER_RESERVATION = 3;

/** Default maximum reservation/spawn cycles before a ticket transitions to `FAILED` (`MM-37`: 3 attempts). */
export const DEFAULT_MAX_TICKET_ATTEMPTS = 3;

/** Default per-attempt `spawnColony` RPC timeout in milliseconds (`MM-35`: 5 s). */
export const DEFAULT_SPAWN_TIMEOUT_MS = 5_000;

/** Default exponential backoff schedule in milliseconds between retries within a reservation (`MM-37`: 1s / 2s / 4s). */
export const DEFAULT_SPAWN_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

/** Terminal failure code when a ticket exhausts all 3 reservation attempts (`MM-37`). */
export const SPAWN_FAILED_CODE = 'spawn_failed';

/** Reason code sent in `system.retireColony` when reconciling a late-spawned orphan colony (`MM-38`). */
export const ORPHAN_RETIRE_REASON = 'reservation_expired';

export interface RetireColonyCommand {
  readonly colonyIndex: number;
  readonly source: 'system';
  readonly commandId: string;
  readonly kind: 'system.retireColony';
  readonly args: {
    readonly colonyId: string;
    readonly reason: 'reservation_expired' | string;
    readonly planetId: string;
    readonly sectorId: SectorId;
    readonly landingSlotId: LandingSlotId;
    readonly slotIndex: number;
    readonly reservationId: string;
    readonly epoch: number;
  };
}

export interface SpawnColonyExecutionRequest {
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly slotIndex: number;
  readonly q: number;
  readonly r: number;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly ticketId: string;
  readonly reservationId: string;
  readonly playerId: string;
  readonly handle: string;
  readonly displayName: string;
  readonly attempt: number;
  readonly maxRetries: number;
  readonly ticketAttempt: number;
  readonly epoch: number;
  readonly expiresAt: string;
  readonly command: SimCommandV1;
  readonly assignment: ColonySeatAssignment;
  readonly reservation: ManagedSectorReservationRecord;
  readonly ticket: MatchTicketRecord;
  readonly planet: PlanetRecord;
  readonly carryOver?: Readonly<Record<string, unknown>> | null;
}

export interface SpawnColonyExecutionOutcome {
  readonly ok: boolean;
  readonly colonyId?: string;
  readonly appliedAtTick?: number;
  readonly spawnTile?: { readonly q: number; readonly r: number };
  readonly duplicate?: boolean;
  readonly code?: string;
  readonly message?: string;
}

export interface RetireColonyExecutionRequest {
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly slotIndex: number;
  readonly q: number;
  readonly r: number;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly ticketId: string;
  readonly reservationId: string;
  readonly playerId: string;
  readonly epoch: number;
  readonly reason: 'reservation_expired' | string;
  readonly command: RetireColonyCommand;
}

export interface RetireColonyExecutionOutcome {
  readonly ok: boolean;
  readonly colonyId: string;
  readonly retiredAtTick?: number;
  readonly reason: string;
}

export type ColonySpawnExecutorFn = (
  request: SpawnColonyExecutionRequest,
) =>
  | Promise<SpawnColonyExecutionOutcome | boolean | void>
  | SpawnColonyExecutionOutcome
  | boolean
  | void;

export interface ColonySpawnExecutorObject {
  spawnColony?(
    request: SpawnColonyExecutionRequest,
  ):
    | Promise<SpawnColonyExecutionOutcome | boolean | void>
    | SpawnColonyExecutionOutcome
    | boolean
    | void;
  retireColony?(
    request: RetireColonyExecutionRequest,
  ):
    | Promise<RetireColonyExecutionOutcome | boolean | void>
    | RetireColonyExecutionOutcome
    | boolean
    | void;
  submit?(
    planetId: string,
    cmd: SimCommandV1 | RetireColonyCommand,
  ): Promise<CommandOutcomeMsg | { readonly ok: boolean; readonly appliedAtTick?: number; readonly code?: string }>;
  onColonySeated?(assignment: ColonySeatAssignment): Promise<void> | void;
}

export type ColonySpawnExecutor = ColonySpawnExecutorFn | ColonySpawnExecutorObject;

export type SpawnBackoffSleepFn = (delayMs: number, attempt: number) => Promise<void> | void;

export type SpawnSagaInput =
  | string
  | SectorReservationRecord
  | ManagedSectorReservationRecord
  | SectorReservationV1
  | MatchTicketRecord
  | {
      readonly reservationId?: string;
      readonly ticketId?: string;
      readonly reservation?: SectorReservationRecord | ManagedSectorReservationRecord | SectorReservationV1;
      readonly ticket?: MatchTicketRecord | null;
    };

export interface ExecuteSpawnSagaOptions {
  readonly now?: Date | (() => Date);
  readonly maxRetries?: number;
  readonly maxSpawnRetriesPerReservation?: number;
  readonly maxTicketAttempts?: number;
  readonly spawnTimeoutMs?: number;
  readonly backoffMs?: readonly number[];
  readonly sleepFn?: SpawnBackoffSleepFn;
  readonly handle?: string;
  readonly displayName?: string;
  readonly executor?: ColonySpawnExecutor;
  readonly spawnExecutor?: ColonySpawnExecutor;
  readonly onRetireColony?: (
    request: RetireColonyExecutionRequest,
  ) => Promise<void> | void;
}

export type SpawnSagaStatus =
  | 'committed'
  | 'expired'
  | 'failed'
  | 'reconciled_orphan'
  | 'fenced';

export interface SpawnSagaOutcome {
  readonly ok: boolean;
  readonly status: SpawnSagaStatus;
  readonly duplicateAck: boolean;
  readonly idempotent: boolean;
  readonly orphanReconciled: boolean;
  readonly requeued: boolean;
  readonly ticketFailed: boolean;
  readonly attemptsUsed: number;
  readonly ticketAttempts: number;
  readonly backoffDelaysMs: readonly number[];
  readonly appliedAtTick: number | null;
  readonly colonyId: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly colony: ColonyRecord | null;
  readonly reservation: ManagedSectorReservationRecord;
  readonly ticket: MatchTicketRecord | null;
  readonly spawnCommand: SimCommandV1 | null;
  readonly retireCommand: RetireColonyCommand | null;
  readonly failureCode: string | null;
  readonly error: string | null;
}

export interface FencedReservationRecord {
  readonly reservationId: string;
  readonly ticketId: string;
  readonly colonyId: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly slotIndex: number;
  readonly q: number;
  readonly r: number;
  readonly epoch: number;
  readonly expiresAt: string;
  readonly reason: 'expired' | 'cancelled' | 'retries_exhausted';
  readonly fencedAt: Date;
}

export interface PendingLateSpawnRecord {
  readonly reservationId: string;
  readonly ticketId: string;
  readonly colonyId: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly slotIndex: number;
  readonly q: number;
  readonly r: number;
  readonly epoch: number;
  readonly expiresAt: string;
  readonly attempt: number;
  readonly startedAt: Date;
  readonly inFlight: boolean;
}

export interface ReconcileOrphanColonyInput {
  readonly colonyId: string;
  readonly reservationId?: string;
  readonly ticketId?: string;
  readonly playerId?: string;
  readonly planetId?: string;
  readonly sectorId?: SectorId;
  readonly landingSlotId?: LandingSlotId;
  readonly slotIndex?: number;
  readonly q?: number;
  readonly r?: number;
  readonly epoch?: number;
  readonly appliedAtTick?: number;
  readonly reason?: 'reservation_expired' | string;
}

export interface ReconciledOrphanColonyRecord {
  readonly colonyId: string;
  readonly reservationId: string;
  readonly ticketId: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly slotIndex: number;
  readonly q: number;
  readonly r: number;
  readonly epoch: number;
  readonly reason: string;
  readonly command: RetireColonyCommand;
  readonly reconciledAt: Date;
}

export interface ReconcileOrphanColonyResult {
  readonly reconciled: boolean;
  readonly alreadyReconciled: boolean;
  readonly duplicateAck: boolean;
  readonly status: 'reconciled_orphan' | 'committed';
  readonly colonyId: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly reason: string;
  readonly colony: ColonyRecord | null;
  readonly ticket: MatchTicketRecord | null;
  readonly reservation: ManagedSectorReservationRecord | null;
  readonly retireCommand: RetireColonyCommand | null;
  readonly orphanColoniesReconciled: number;
}

export interface DefaultSimColonyState {
  readonly colonyId: string;
  readonly playerId: string;
  readonly planetId: string;
  readonly sectorId: SectorId;
  readonly landingSlotId: LandingSlotId;
  readonly slotIndex: number;
  readonly colonyIndex: number;
  readonly q: number;
  readonly r: number;
  readonly appliedAtTick: number;
  readonly status: 'ACTIVE' | 'RETIRED';
  readonly retiredReason?: string;
}

export interface SpawnSagaMetricsSnapshot {
  readonly orphanColoniesReconciled: number;
  readonly reservationsExpired: number;
  readonly spawnsCommitted: number;
  readonly spawnsFailed: number;
  readonly duplicateAcks: number;
  readonly retryAttempts: number;
  readonly pendingLateSpawns: number;
}
