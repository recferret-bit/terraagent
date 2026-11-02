import type { ClientMessageOf } from '@terra/contracts';

/** What a socket tells the ingress about itself when a `cmd` arrives. */
export interface CommandContext {
  readonly playerId: string;
  readonly planetId: string;
  /** A `dev:` session: only it may play colony 0 of a scenario planet without a colony row (BE-07). */
  readonly dev?: boolean;
  /**
   * Per-socket memo of the colony lookup on the joined planet (BE-09): a miss is remembered for the socket's lifetime on
   * that planet, so a spectator or dev session does not query the database on every command. Owned by the socket.
   */
  readonly memo?: { planetId?: string; colony?: null };
  /** Sends a server message on the socket that submitted the command. */
  reply(msg: object): void;
}

/** Validates a `cmd` frame, submits it to the owning planet thread, answers with `cmd.ack`/`cmd.reject` (PROTOCOL §4.2). */
export interface CommandIngress {
  handle(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>): Promise<void> | void;
}

export const COMMAND_INGRESS = Symbol('COMMAND_INGRESS');
