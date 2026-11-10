import type { TreasuryEffectKind } from '@terra/contracts';
import { dataRow } from '../../data';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { parseArgs } from '../command';
import { rowNum } from '../rows';
import { readTreasury, writeTreasury, type TreasuryEffectRecord } from './blob';

/** Module sources only. Clients are already refused (`origin: 'module'`); this is the sim-side gate. */
const MODULE_SOURCES: ReadonlySet<string> = new Set(['system', 'near', 'admin', 'dev']);

export const treasuryEffectHandler = defineCommandHandler({
  kind: 'system.treasuryEffect',
  wave: 'W22',
  handle(state, cmd, ctx) {
    return applyTreasuryEffect(state, cmd, ctx);
  },
});

function applyTreasuryEffect(state: PlanetState, cmd: SimCommand, ctx: StepContext): string | void {
  const args = parseArgs('system.treasuryEffect', cmd.args);
  if (!args) return 'invalid_args';
  if (!MODULE_SOURCES.has(cmd.source)) return 'not_authorized';
  const record = effectRecord(ctx, args.kind, args.untilTick, args.params?.magnitudeBp, args.params?.visits);
  const blob = readTreasury(state);
  blob.effects[args.kind] = record;
  writeTreasury(state, blob, ctx.tick);
  ctx.emit({
    kind: 'treasuryEffectStarted',
    data: {
      planetId: state.meta.planetId,
      kind: args.kind,
      untilTick: record.untilTick,
      magnitudeBp: record.magnitudeBp,
      ...(record.visits !== undefined ? { visits: record.visits } : {}),
    },
  });
}

function effectRecord(
  ctx: StepContext,
  kind: TreasuryEffectKind,
  untilTick: number,
  magnitudeBp: number | undefined,
  visits: number | undefined,
): TreasuryEffectRecord {
  const row = dataRow(ctx.data, 'treasury', kind);
  const record: TreasuryEffectRecord = { untilTick, magnitudeBp: magnitudeBp ?? rowNum(row, 'magnitudeBp') };
  const visitCount = visits ?? rowNum(row, 'visits');
  if (visitCount > 0) record.visits = visitCount;
  return record;
}
