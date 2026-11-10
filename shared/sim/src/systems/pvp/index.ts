import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { checkAiRaidAwayPolicy } from '../away/gate';
import { commandColony, parseArgs } from '../command';
import { defineSimModule } from '../define';
import { resolveColonyIndex } from '../diplomacy/store';
import { registerGoalExecutor } from '../goals/executors';
import { stepActiveRaids } from './raidPathing';
import { launchColonyRaid, stepRaidTargetGoal } from './raidTask';
import { setColonyShieldHours, syncAllColonyShields } from './shield';
import { stepRaidSiphon } from './siphon';

export * from './store';
export * from './shield';
export * from './sectorGuard';
export * from './raidFlowMarch';
export * from './raidPathing';
export * from './raidTask';
export * from './siphon';

registerGoalExecutor('raid_target', stepRaidTargetGoal, { wave: 'W18' });

export const raidHandler = defineCommandHandler({
  kind: 'raid',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const awayGate = checkAiRaidAwayPolicy(state, colIdx, cmd, ctx);
    if (awayGate) return awayGate;
    const parsed = parseArgs('raid', cmd.args);
    if (!parsed) return 'invalid_args';
    const targetRef = parsed.targetColonyId ?? parsed.targetColonyIndex ?? parsed.targetColony;
    const toColony = resolveColonyIndex(state, targetRef);
    const res = launchColonyRaid(state, colIdx, toColony, ctx, {
      unitIds: parsed.unitIds ?? parsed.entityIds,
      q: parsed.q,
      r: parsed.r,
      data: ctx.data,
    });
    return res.ok ? undefined : res.code;
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
    stepActiveRaids(state, ctx);
    stepRaidSiphon(state, ctx);
  },
});

export const pvp = defineSimModule({
  id: 'pvp',
  wave: 'W18',
  systems: [pvpSystem],
  handlers: [raidHandler, devSetShieldHandler],
});

export default pvp;
