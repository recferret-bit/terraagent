import { defineCommandHandler } from '../../kernel/commands';
import { colonyIsAway } from '../away';
import { checkAiCancelTrucePolicy, resolveColonyAwayRaids } from '../away/gate';
import { commandColony, parseArgs } from '../command';
import { cancelTruce, cancelWar, declareWar, devOfferTruce, proposeTruce, respondTruce } from './operations';
import { resolveColonyIndex } from './store';

const EXEMPT_AI_SOURCES = new Set(['player', 'dev', 'admin', 'system']);

export const proposeTruceHandler = defineCommandHandler({
  kind: 'diplomacy.proposeTruce',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const awayGate = checkAiCancelTrucePolicy(cmd, state);
    if (awayGate) return awayGate;
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.proposeTruce', cmd.args);
    if (!parsed) return 'invalid_args';
    const targetRef =
      parsed.targetColonyId ?? parsed.targetColonyIndex ?? parsed.targetColony ?? parsed.toColony;
    const hours = parsed.hours ?? parsed.durationHours;
    if (targetRef === undefined || hours === undefined) return 'invalid_args';
    const res = proposeTruce(state, colIdx, targetRef, hours, ctx.tick, ctx, {
      bondAmount: parsed.bondAmount,
      bondToken: parsed.bondToken,
    });
    if (!res.ok) return { code: res.code, detail: res.detail };
  },
});

export const respondTruceHandler = defineCommandHandler({
  kind: 'diplomacy.respondTruce',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const awayGate = checkAiCancelTrucePolicy(cmd, state);
    if (awayGate) return awayGate;
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
    const awayGate = checkAiCancelTrucePolicy(cmd, state);
    if (awayGate) return awayGate;
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.cancelTruce', cmd.args);
    if (!parsed) return 'invalid_args';
    const res = cancelTruce(state, colIdx, parsed.truceId, ctx.tick, ctx);
    if (!res.ok) return { code: res.code, detail: res.detail };
  },
});

export const declareWarHandler = defineCommandHandler({
  kind: 'diplomacy.declareWar',
  wave: 'W22',
  handle(state, cmd, ctx) {
    const awayGate = checkAiCancelTrucePolicy(cmd, state);
    if (awayGate) return awayGate;
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    if (!EXEMPT_AI_SOURCES.has(cmd.source) && !resolveColonyAwayRaids(state, colIdx)) {
      return { code: 'away_policy', detail: 'AW-11' };
    }
    const parsed = parseArgs('diplomacy.declareWar', cmd.args);
    if (!parsed) return 'invalid_args';
    const targetRef =
      parsed.targetColonyId ?? parsed.targetColonyIndex ?? parsed.targetColony ?? parsed.toColony;
    if (targetRef === undefined) return 'invalid_args';
    const res = declareWar(
      state,
      colIdx,
      targetRef,
      parsed.bondAmount,
      parsed.bondToken ?? 'NEAR',
      ctx.tick,
      ctx,
    );
    if (!res.ok) return { code: res.code, detail: res.detail };
  },
});

export const cancelWarHandler = defineCommandHandler({
  kind: 'diplomacy.cancelWar',
  wave: 'W22',
  handle(state, cmd, ctx) {
    const awayGate = checkAiCancelTrucePolicy(cmd, state);
    if (awayGate) return awayGate;
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.cancelWar', cmd.args);
    if (!parsed) return 'invalid_args';
    const res = cancelWar(state, colIdx, parsed.warId, ctx.tick, ctx);
    if (!res.ok) return { code: res.code, detail: res.detail };
  },
});

export const devOfferTruceHandler = defineCommandHandler({
  kind: 'dev.offerTruce',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.offerTruce', cmd.args);
    if (!parsed) return 'invalid_args';
    let toColony =
      parsed.toColony !== undefined
        ? resolveColonyIndex(state, parsed.toColony)
        : typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0
          ? cmd.colonyIndex
          : 0;
    const fromRef = parsed.fromColony ?? parsed.colony ?? (toColony === 0 ? 1 : 0);
    let fromColony = resolveColonyIndex(state, fromRef);
    if (fromColony >= 0 && toColony >= 0 && colonyIsAway(state, fromColony) && !colonyIsAway(state, toColony)) {
      const tmp = fromColony;
      fromColony = toColony;
      toColony = tmp;
    }
    const hours = parsed.hours ?? parsed.durationHours ?? 6;
    const offer = devOfferTruce(state, fromColony, toColony, hours, ctx.tick, ctx);
    if (!offer) return 'invalid_args';
  },
});
