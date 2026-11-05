import { defineCommandHandler } from '../../kernel/commands';
import { rowOf } from '../../ecs/store';
import { commandColony, parseArgs } from '../command';
import { issueUnitCommand } from './registry';

/** Client command `unitReserve { entityIds, reserve }`: every id must be an own unit; the first reject code wins, nothing partial. */
export const unitReserve = defineCommandHandler({
  kind: 'unitReserve',
  wave: 'W13',
  handle(state, cmd, ctx) {
    const args = parseArgs('unitReserve', cmd.args);
    if (!args) return 'invalid_args';
    const colony = commandColony(cmd);
    if (typeof colony === 'string') return colony;
    const rows: number[] = [];
    for (const id of [...new Set(args.entityIds)].sort((a, b) => a - b)) {
      const row = rowOf(state.entities, id);
      if (row < 0) return 'unknown_entity';
      if (state.entities.cols.owner[row] !== colony) return 'not_own_colony';
      rows.push(row);
    }
    for (const row of rows) {
      const code = issueUnitCommand(state, row, { kind: 'reserve', source: 'player', on: args.reserve }, ctx);
      if (code) return code;
    }
  },
});
