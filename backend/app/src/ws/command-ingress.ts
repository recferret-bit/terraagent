import type { ClientMessageOf } from '@terra/contracts';
import type { AntiCheatTransport } from '../core/anticheat';

/** What a socket or HTTP command route tells the ingress about itself when a `cmd` arrives. */
export interface CommandContext {
  readonly playerId: string;
  readonly planetId: string;
  readonly transport?: AntiCheatTransport;
  /** Validated colony ID pinned when the session joined (disambiguates same-planet multi-colony). */
  readonly colonyId?: string;
  /** Validated base sector pinned when the session joined. */
  readonly sectorId?: string;
  /** Real-time FNV-1a 64-bit colony/planet/sector hash pinned when the session joined. */
  readonly bindingHash?: string;
  /** A `dev:` session: only it may play colony 0 of a scenario planet without a colony row (BE-07). */
  readonly dev?: boolean;
  /**
   * Per-socket memo of the colony lookup on the joined planet (BE-09). A miss (`null`) and a hit (the row) are both
   * remembered for the socket's lifetime on that planet, so gameplay commands do not query the database again.
   * Owned by the socket.
   */
  readonly memo?: { planetId?: string; colonyId?: string; colony?: MemoColony | null };
  /** Sends a server message on the socket (or resolves the HTTP command response). */
  reply(msg: object): void;
}

/** The colony fields the ingress caches on a socket. A full `ColonyRecord` assigns to this. */
export interface MemoColony {
  id: string;
  colonyIndex: number;
  status?: string;
  state?: string;
  playerId?: string;
  planetId?: string;
  name?: string;
  foundingSectorId?: string;
  spawnQ?: number;
  spawnR?: number;
}

/** Validates a `cmd` frame, submits it to the owning planet thread, answers with `cmd.ack`/`cmd.reject` (PROTOCOL §4.2). */
export interface CommandIngress {
  handle(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>): Promise<void> | void;
}

export const COMMAND_INGRESS = Symbol('COMMAND_INGRESS');
