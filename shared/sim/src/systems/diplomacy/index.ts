import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { commandColony, parseArgs } from '../command';
import { defineSimModule } from '../define';

export const proposeTruceHandler = defineCommandHandler({
  kind: 'diplomacy.proposeTruce',
  wave: 'W18',
  handle(_state, cmd, _ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.proposeTruce', cmd.args);
    if (!parsed) return 'invalid_args';
  },
});

export const respondTruceHandler = defineCommandHandler({
  kind: 'diplomacy.respondTruce',
  wave: 'W18',
  handle(_state, cmd, _ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.respondTruce', cmd.args);
    if (!parsed) return 'invalid_args';
  },
});

export const cancelTruceHandler = defineCommandHandler({
  kind: 'diplomacy.cancelTruce',
  wave: 'W18',
  handle(_state, cmd, _ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('diplomacy.cancelTruce', cmd.args);
    if (!parsed) return 'invalid_args';
  },
});

export const devOfferTruceHandler = defineCommandHandler({
  kind: 'dev.offerTruce',
  wave: 'W18',
  handle(_state, cmd, _ctx) {
    const parsed = parseArgs('dev.offerTruce', cmd.args);
    if (!parsed) return 'invalid_args';
  },
});

export const diplomacySystem = defineSystem({
  id: 'diplomacy.manager',
  slot: 11,
  wave: 'W18',
  run() {},
});

export const diplomacy = defineSimModule({
  id: 'diplomacy',
  wave: 'W18',
  systems: [diplomacySystem],
  handlers: [proposeTruceHandler, respondTruceHandler, cancelTruceHandler, devOfferTruceHandler],
});

export default diplomacy;
