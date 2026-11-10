import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { commandColony, parseArgs } from '../command';
import { defineSimModule } from '../define';

export const raidHandler = defineCommandHandler({
  kind: 'raid',
  wave: 'W18',
  handle(_state, cmd, _ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('raid', cmd.args);
    if (!parsed) return 'invalid_args';
  },
});

export const devSetShieldHandler = defineCommandHandler({
  kind: 'dev.setShield',
  wave: 'W18',
  handle(_state, cmd, _ctx) {
    const parsed = parseArgs('dev.setShield', cmd.args);
    if (!parsed) return 'invalid_args';
  },
});

export const pvpSystem = defineSystem({
  id: 'pvp.manager',
  slot: 10,
  wave: 'W18',
  run() {},
});

export const pvp = defineSimModule({
  id: 'pvp',
  wave: 'W18',
  systems: [pvpSystem],
  handlers: [raidHandler, devSetShieldHandler],
});

export default pvp;
