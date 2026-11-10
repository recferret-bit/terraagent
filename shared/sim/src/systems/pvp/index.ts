import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { commandColony, parseArgs } from '../command';
import { defineSimModule } from '../define';
import { hasActiveTruce, resolveColonyIndex } from '../diplomacy/store';
import {
  dropColonyShield,
  isColonyRaidProtected,
  setColonyShieldHours,
  syncAllColonyShields,
} from './shield';

export * from './store';
export * from './shield';

export const raidHandler = defineCommandHandler({
  kind: 'raid',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('raid', cmd.args);
    if (!parsed) return 'invalid_args';
    const targetRef = parsed.targetColonyId ?? parsed.targetColonyIndex ?? parsed.targetColony;
    const toColony = resolveColonyIndex(state, targetRef);
    if (toColony < 0 || toColony === colIdx) return 'invalid_args';
    if (hasActiveTruce(state, colIdx, toColony, ctx.tick)) return 'truce_active';
    if (isColonyRaidProtected(state, toColony, ctx.tick, ctx.data)) return 'raid_protected';
    dropColonyShield(state, colIdx, ctx.tick, ctx.data);
  },
});

export const devSetShieldHandler = defineCommandHandler({
  kind: 'dev.setShield',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.setShield', cmd.args);
    if (!parsed) return 'invalid_args';
    const rawRef = parsed.colonyIndex ?? parsed.colonyId;
    let colIdx = 0;
    if (rawRef !== undefined) {
      const resolved = resolveColonyIndex(state, rawRef);
      if (resolved < 0) return 'invalid_args';
      colIdx = resolved;
    } else if (typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0) {
      colIdx = cmd.colonyIndex;
    }
    setColonyShieldHours(state, colIdx, parsed.hours, ctx.tick, ctx.data);
  },
});

export const pvpSystem = defineSystem({
  id: 'pvp.manager',
  slot: 10,
  wave: 'W18',
  run(state, ctx) {
    syncAllColonyShields(state, ctx.tick, ctx.data);
  },
});

export const pvp = defineSimModule({
  id: 'pvp',
  wave: 'W18',
  systems: [pvpSystem],
  handlers: [raidHandler, devSetShieldHandler],
});

export default pvp;
