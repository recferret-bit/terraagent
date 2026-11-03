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
  help: 'contact.fake [colonyIndex]  Fake neighbour/Guild contact so Trade Hub unlocks below Stage 5 (W10-03)',
  async run(a, ctx) {
    const rawIdx = a[0] !== undefined && a[0] !== '' ? Number(a[0]) : undefined;
    const colonyIndex =
      rawIdx !== undefined && Number.isInteger(rawIdx) && rawIdx >= 0 ? rawIdx : undefined;
    const r = await sim(ctx, 'dev.contactFake', {
      ...(colonyIndex !== undefined ? { colonyIndex } : {}),
    });
    return ackText('dev.contactFake', r);
  },
};

export default defineFeature({
  id: 'cargo-unlock',
  wave: 'W10',
  devCommands: [contactFakeCmd],
});
