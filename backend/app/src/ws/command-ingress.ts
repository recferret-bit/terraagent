import type { ClientMessageOf } from '@terra/contracts';

/** What a socket tells the ingress about itself when a `cmd` arrives. */
export interface CommandContext {
  readonly playerId: string;
  readonly planetId: string;
  /** Sends a server message on the socket that submitted the command. */
  reply(msg: object): void;
}

/** Validates a `cmd` frame, submits it to the owning planet thread, answers with `cmd.ack`/`cmd.reject` (PROTOCOL §4.2). */
export interface CommandIngress {
  handle(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>): Promise<void> | void;
}

export const COMMAND_INGRESS = Symbol('COMMAND_INGRESS');
