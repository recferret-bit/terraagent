import { defineCommandHandler } from '../../kernel/commands';
import { commandColony, parseArgs } from '../command';
import { cancelTruce, devOfferTruce, proposeTruce, respondTruce } from './operations';
import { resolveColonyIndex } from './store';

export const proposeTruceHandler = defineCommandHandler({
  kind: 'diplomacy.proposeTruce',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.proposeTruce', cmd.args);
    if (!parsed) return 'invalid_args';
    const targetRef =
      parsed.targetColonyId ?? parsed.targetColonyIndex ?? parsed.targetColony ?? parsed.toColony;
    const hours = parsed.hours ?? parsed.durationHours;
    if (targetRef === undefined || hours === undefined) return 'invalid_args';
    const res = proposeTruce(state, colIdx, targetRef, hours, ctx.tick, ctx);
    if (!res.ok) return { code: res.code, detail: res.detail };
  },
});

export const respondTruceHandler = defineCommandHandler({
  kind: 'diplomacy.respondTruce',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.respondTruce', cmd.args);
    if (!parsed) return 'invalid_args';
    const res = respondTruce(state, colIdx, parsed.offerId, parsed.accept, ctx.tick, ctx);
    if (!res.ok) return { code: res.code, detail: res.detail };
  },
});

export const cancelTruceHandler = defineCommandHandler({
  kind: 'diplomacy.cancelTruce',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.cancelTruce', cmd.args);
    if (!parsed) return 'invalid_args';
    const res = cancelTruce(state, colIdx, parsed.truceId, ctx.tick, ctx);
    if (!res.ok) return { code: res.code, detail: res.detail };
  },
});

export const devOfferTruceHandler = defineCommandHandler({
  kind: 'dev.offerTruce',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.offerTruce', cmd.args);
    if (!parsed) return 'invalid_args';
    const toColony =
      parsed.toColony !== undefined
        ? resolveColonyIndex(state, parsed.toColony)
        : typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0
          ? cmd.colonyIndex
          : 0;
    const fromRef = parsed.fromColony ?? parsed.colony ?? (toColony === 0 ? 1 : 0);
    const fromColony = resolveColonyIndex(state, fromRef);
    const hours = parsed.hours ?? parsed.durationHours ?? 6;
    const offer = devOfferTruce(state, fromColony, toColony, hours, ctx.tick, ctx);
    if (!offer) return 'invalid_args';
  },
});
