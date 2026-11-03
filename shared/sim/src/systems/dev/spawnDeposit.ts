import { hexIndex } from '../../grid/hex';
import { DEPOSIT } from '../../grid/layers';
import { setTileDeposit } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import { commandColony, parseArgs } from '../command';
import { terraformFindSpec } from '../terraform-basic/resourceSpawn';

/**
 * `dev.spawndeposit <q> <r> <metals|minerals|oil> <1|2|3>` (dev console `spawndeposit`): places a full deposit of that
 * family and tier on the tile, as a terraform find would (`terraformFinds.deposit.richnessBp`; stamped, so the delta
 * carries it). Replaces whatever deposit the tile had.
 */
export const devSpawnDeposit = defineCommandHandler({
  kind: 'dev.spawndeposit',
  wave: 'W02',
  handle(state, cmd, ctx) {
    const colony = commandColony(cmd);
    if (typeof colony === 'string') return colony;
    const args = parseArgs('dev.spawndeposit', cmd.args);
    if (!args) return 'invalid_args';
    const i = hexIndex(state.grid.radius).indexOf(args.q, args.r);
    if (i < 0) return 'invalid_args';
    setTileDeposit(state.grid, i, DEPOSIT[args.family], terraformFindSpec(ctx.data).richnessBp, ctx.tick, args.tier);
  },
});
