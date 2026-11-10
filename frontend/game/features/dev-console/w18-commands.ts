import type { DevCommandDef } from '../../core/registry/types';
import { numArg } from '../../dev/console/parse';
import { ownColonyIndex } from '../shared/colony';
import { ackText, sim } from './sim';

export function parseColonyTarget(raw?: string): { colonyIndex?: number; colonyId?: string } {
  if (!raw) return {};
  if (/^\d+$/.test(raw)) {
    return { colonyIndex: Number(raw) };
  }
  return { colonyId: raw };
}

export const killHqCommand: DevCommandDef = {
  name: 'killHq',
  help: 'killHq [colony]  Destroy HQ unit of target colony (by index or id; default: caller colony)',
  async run(a, ctx) {
    const colony = parseColonyTarget(a[0]);
    return ackText('dev.killHq', await sim(ctx, 'dev.killHq', colony));
  },
};

export const killHubCommand: DevCommandDef = {
  name: 'killHub',
  help: 'killHub [colony]  Destroy Command Hub of target colony (by index or id; default: caller colony)',
  async run(a, ctx) {
    const colony = parseColonyTarget(a[0]);
    return ackText('dev.killHub', await sim(ctx, 'dev.killHub', colony));
  },
};

export const setShieldCommand: DevCommandDef = {
  name: 'setShield',
  help: 'setShield <h> [colony]  Set newcomer raid protection duration in hours (>= 0)',
  async run(a, ctx) {
    const hours = numArg(a, 0, 'h');
    if (hours < 0) throw new Error('<h> must be >= 0');
    const colony = parseColonyTarget(a[1]);
    return ackText('dev.setShield', await sim(ctx, 'dev.setShield', { hours, ...colony }));
  },
};

export const offerTruceCommand: DevCommandDef = {
  name: 'offerTruce',
  help: 'offerTruce <colony> [h]  Inject a truce offer from neighbor colony (default h = 6)',
  async run(a, ctx) {
    const rawColony = a[0];
    if (!rawColony) throw new Error('missing <colony>');
    const fromColony = /^\d+$/.test(rawColony) ? Number(rawColony) : rawColony;
    const hours = a[1] !== undefined ? numArg(a, 1, 'h') : 6;
    if (hours <= 0) throw new Error('<h> must be > 0');
    const toColony = ownColonyIndex(ctx.services);
    return ackText(
      'dev.offerTruce',
      await sim(ctx, 'dev.offerTruce', {
        fromColony,
        toColony,
        hours,
        durationHours: hours,
      }),
    );
  },
};

export const devOfferTruceCommand: DevCommandDef = {
  ...offerTruceCommand,
  name: 'dev.offerTruce',
};

export const w18DevCommands: DevCommandDef[] = [
  killHqCommand,
  killHubCommand,
  setShieldCommand,
  offerTruceCommand,
  devOfferTruceCommand,
];
