import type { FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';

export async function sim(ctx: FeatureContext, kind: string, args: unknown): Promise<CommandResult> {
  const send =
    ctx.services.sendCommand ??
    (ctx.services.store as { sendCommand?: (k: string, a: unknown) => Promise<CommandResult> } | undefined)
      ?.sendCommand;
  return send ? send(kind, args) : { ok: false, code: 'not_connected', detail: 'no game server connection' };
}

export function ackText(kind: string, r: CommandResult): string {
  if (r.ok) {
    return r.appliedAtTick !== undefined
      ? `${kind} ok, applied at tick ${r.appliedAtTick}`
      : `${kind} ok`;
  }
  throw new Error(`${kind} rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
}
