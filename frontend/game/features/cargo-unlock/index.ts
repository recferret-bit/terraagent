import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';

async function sim(ctx: FeatureContext, kind: string, args: unknown): Promise<CommandResult> {
  const send = ctx.services.sendCommand;
  return send
    ? send(kind, args)
    : { ok: false, code: 'not_connected', detail: 'no game server connection' };
}

function ackText(kind: string, r: CommandResult): string {
  if (r.ok) return `${kind} ok, applied at tick ${r.appliedAtTick}`;
  throw new Error(`${kind} rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
}

export const contactFakeCmd: DevCommandDef = {
  name: 'contact.fake',
  help: 'contact.fake [1|0|off]  Fake neighbour/Guild contact so Trade Hub unlocks below Stage 5 (W10-03)',
  async run(a, ctx) {
    const raw = (a[0] ?? '').trim().toLowerCase();
    const enabled = raw !== 'false' && raw !== 'off';
    const r = await sim(ctx, 'dev.contactFake', {
      colonyIndex: 0,
      enabled,
    });
    return ackText('dev.contactFake', r);
  },
};

export default defineFeature({
  id: 'cargo-unlock',
  wave: 'W10',
  devCommands: [contactFakeCmd],
  consoleCommands: [contactFakeCmd],
});
