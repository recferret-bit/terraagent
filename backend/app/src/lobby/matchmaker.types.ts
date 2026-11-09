import type {
  SectorId,
  SectorReservationV1,
} from '@terra/contracts';
import type { GeneratedSmallAtlas, PlanetState, SimState } from '@terra/sim';
import type {
  MatchTicketRecord,
  PlanetSectorRecord,
  SectorIntentInput,
  SectorLandingSlotRecord,
  TransferCarryRecord,
} from './lobby-persistence.types';
import type {
  ManagedSectorReservationRecord,
  SimLandingAuthorityValidator,
} from './reservation.types';

/** Default batch size per matchmaker tick (MATCHMAKING §5.3 MM-42, §8: `MM_BATCH = 50`). */
export const MM_BATCH = 50;

/** Default priority for `TRANSFER` tickets (MATCHMAKING §5.2 MM-34, §5.4 MM-47: `priority = 10`). */
export const MM_TRANSFER_PRIORITY = 10;

/** Initial EWMA assignment duration in seconds for queue ETA calculation (MATCHMAKING §5.4 MM-48). */
export const MM_DEFAULT_AVG_ASSIGN_S = 5;

/** EWMA smoothing factor α=0.2 for assignment duration (MATCHMAKING §5.4 MM-48). */
export const MM_EWMA_ALPHA = 0.2;

export type MatchmakerTicketOutcome =
  | 'reserved'
  | 'queued_chosen_sector_full'
  | 'queued_planet_full'
  | 'queued_world_unavailable'
  | 'transfer_pending'
  | 'queue_paused'
  | 'skipped';

export interface ProcessTicketOptions {
  readonly now?: Date;
  readonly ttlMs?: number;
  readonly ttlS?: number;
  readonly authorityValidator?: SimLandingAuthorityValidator;
  readonly simState?: SimState | PlanetState | null;
  readonly generatedAtlas?: GeneratedSmallAtlas | null;
}

export interface ProcessTicketResult {
  readonly outcome: MatchmakerTicketOutcome;
  readonly reserved: boolean;
  readonly idempotent?: boolean;
  readonly ticket: MatchTicketRecord;
  readonly reservation: ManagedSectorReservationRecord | null;
  readonly reservationV1: SectorReservationV1 | null;
  readonly sector: PlanetSectorRecord | null;
  readonly slot: SectorLandingSlotRecord | null;
  readonly alternativeSectors: readonly SectorId[];
  readonly transferCarry: TransferCarryRecord | null;
  readonly reason?: string;
}

export interface AcceptAlternativeSectorOptions extends ProcessTicketOptions {
  readonly processImmediately?: boolean;
}

export interface AcceptAlternativeSectorInput extends AcceptAlternativeSectorOptions {
  readonly ticketId: string;
  readonly playerId?: string;
  readonly newSectorIntent?: SectorIntentInput | SectorId;
  readonly sectorIntent?: SectorIntentInput | SectorId;
  readonly sectorId?: SectorId;
  readonly autoSector?: boolean;
}

export interface RunMatchmakerTickOptions extends ProcessTicketOptions {
  readonly batchSize?: number;
  readonly planetId?: string;
}

export interface MatchmakerTickSummary {
  readonly queuePaused: boolean;
  readonly batchSize: number;
  readonly processed: number;
  readonly reserved: number;
  readonly queued: number;
  readonly transferPending: number;
  readonly expiredReservations: number;
  readonly reservedTickets: readonly MatchTicketRecord[];
  readonly queuedTickets: readonly MatchTicketRecord[];
  readonly transferPendingTickets: readonly MatchTicketRecord[];
  readonly expiredReservationRecords: readonly ManagedSectorReservationRecord[];
  readonly results: readonly ProcessTicketResult[];
}
