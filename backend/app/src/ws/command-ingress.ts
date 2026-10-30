import type { ClientMessageOf } from '@terra/contracts';

/** What a socket tells the ingress about itself when a `cmd` arrives. */
export interface CommandContext {
  readonly playerId: string;
  readonly planetId: string;
  /** Sends a server message on the socket that submitted the command. */
  reply(msg: object): void;
}

/** Hook for the command pipeline (next issue): validates a `cmd` frame, submits it, answers with `cmd.ack`/`cmd.reject`. */
export interface CommandIngress {
  handle(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>): Promise<void> | void;
}

export const COMMAND_INGRESS = Symbol('COMMAND_INGRESS');

/** Placeholder until commands are wired. */
export class NotWiredCommandIngress implements CommandIngress {
  handle(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>): void {
    ctx.reply({ v: 1, t: 'cmd.reject', d: { id: cmd.id, code: 'internal', detail: 'commands not wired yet' } });
  }
}
