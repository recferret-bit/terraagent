import {
  GOAL_KINDS,
  STAGE_OVERRIDES,
  type GoalKind,
  type GoalParams,
  type StageOverride,
} from '@terra/contracts';
import {
  getStageSpec,
  NEED_AUTOMATION_TABLE,
  OVERRIDE_TARGET_STAGE,
  resolveNeedMode,
  type AutopilotDecision,
  type NeedKey,
  type ViewColony,
} from '@terra/sim';
import type { DevCommandDef, FeatureContext, GameView } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';
import { ownColonyIndex, viewColony } from '../shared/colony';

declare module '../../core/registry/types' {
  interface FeatureServices {
    view?: GameView | (() => GameView | undefined);
    getView?: () => GameView | undefined;
  }
}

async function sim(ctx: FeatureContext, kind: string, args: unknown): Promise<CommandResult> {
  const send = ctx.services.sendCommand;
  if (!send) {
    throw new Error('no game server connection');
  }
  const res = await send(kind, args);
  if (!res.ok) {
    throw new Error(`${kind} rejected: ${res.code}${res.detail ? ` (${res.detail})` : ''}`);
  }
  return res;
}

function tickSuffix(r: CommandResult): string {
  return r.ok && typeof r.appliedAtTick === 'number' ? ` (applied at tick ${r.appliedAtTick})` : '';
}

function getSimView(ctx: FeatureContext): GameView | undefined {
  if (typeof ctx.services.getView === 'function') {
    return ctx.services.getView();
  }
  if (typeof ctx.services.view === 'function') {
    return (ctx.services.view as () => GameView | undefined)();
  }
  if (ctx.services.view) {
    return ctx.services.view as GameView;
  }
  if (ctx.services.store?.latest) {
    return ctx.services.store.latest as unknown as GameView;
  }
  return undefined;
}

function normalizeGoalType(input: string): GoalKind {
  const s = input.trim().toLowerCase().replace(/-/g, '_');
  const aliases: Record<string, GoalKind> = {
    establish: 'establish_colony',
    grow: 'grow_economy',
    economy: 'grow_economy',
    power: 'secure_power',
    energy: 'secure_power',
    secure: 'secure_power',
    defend: 'defend_colony',
    clear: 'clear_corridor',
    expand: 'expand_territory',
    terraform: 'terraform_zone',
    tech: 'tech_up',
    negotiate: 'negotiate_supply',
    army: 'build_army',
    raid: 'raid_target',
    rocket: 'build_rocket',
  };
  if (aliases[s]) return aliases[s];
  if ((GOAL_KINDS as readonly string[]).includes(s)) return s as GoalKind;
  throw new Error(`unknown goal type '${input}'. Valid types: ${GOAL_KINDS.join(', ')}`);
}

function normalizeResourceShorthand(res: string): string {
  const lower = res.trim().toLowerCase();
  if (lower === 'metals') return 'metals.t1';
  if (lower === 'minerals') return 'minerals.t1';
  if (lower === 'bio' || lower === 'biomass') return 'bio.biomass';
  if (lower === 'water') return 'bio.water';
  return lower;
}

export const stageCommand: DevCommandDef = {
  name: 'stage',
  help: 'stage <set <0..10> | skip-dwell | trigger <fauna|rival|resource|power|storage>>  Control colony progression stage, dwell timer, or safety overrides (overrides: fauna, rival, resource, power, storage)',
  async run(a, ctx) {
    const sub = a[0]?.toLowerCase();
    if (!sub || sub === 'help') {
      return `stage <set <0..10> | skip-dwell | trigger <fauna|rival|resource|power|storage>>\noverrides: ${STAGE_OVERRIDES.join(', ')}`;
    }
    if (sub === 'set') {
      const stage = Number(a[1]);
      if (!Number.isInteger(stage) || stage < 0 || stage > 10) {
        throw new Error('usage: stage set <0..10>');
      }
      const r = await sim(ctx, 'dev.stage', { op: 'set', stage });
      return `stage set to S${stage}${tickSuffix(r)}`;
    }
    if (sub === 'skip-dwell' || sub === 'skip_dwell' || sub === 'skip') {
      const r = await sim(ctx, 'dev.stage', { op: 'skip-dwell' });
      return `stage dwell skipped${tickSuffix(r)}`;
    }
    if (sub === 'trigger') {
      const override = a[1]?.toLowerCase();
      if (!override || !(STAGE_OVERRIDES as readonly string[]).includes(override)) {
        throw new Error(`unknown override '${a[1] ?? ''}'. Valid overrides: ${STAGE_OVERRIDES.join(', ')}`);
      }
      const r = await sim(ctx, 'dev.stage', { op: 'trigger', override: override as StageOverride });
      const targetStage = OVERRIDE_TARGET_STAGE[override as StageOverride];
      const stageLabel = getStageSpec(targetStage)?.label ?? `S${targetStage}`;
      return `stage override '${override}' triggered -> ${stageLabel}${tickSuffix(r)}`;
    }
    throw new Error(`unknown stage subcommand '${a[0]}'. Usage: ${stageCommand.help}`);
  },
};

export const goalCommand: DevCommandDef = {
  name: 'goal',
  help: 'goal <add <type> [resource] [rate] | cancel <goalId> | clear>  Queue, cancel, or clear HQ goals (e.g. goal add grow_economy metals 10)',
  async run(a, ctx) {
    const sub = a[0]?.toLowerCase();
    if (!sub || sub === 'help') {
      return goalCommand.help;
    }
    if (sub === 'add') {
      const rawType = a[1];
      if (!rawType) {
        throw new Error('usage: goal add <type> [resource] [rate]');
      }
      const goal = normalizeGoalType(rawType);
      const params: GoalParams = {};
      if (goal === 'grow_economy') {
        const arg1 = a[2];
        const arg2 = a[3];
        if (arg1 !== undefined) {
          const num1 = Number(arg1);
          if (!isNaN(num1) && arg1.trim() !== '') {
            params.resource = 'metals.t1';
            params.targetRatePerMin = num1;
          } else {
            params.resource = normalizeResourceShorthand(arg1);
            if (arg2 !== undefined) {
              const num2 = Number(arg2);
              params.targetRatePerMin = !isNaN(num2) ? num2 : 10;
            } else {
              params.targetRatePerMin = 10;
            }
          }
        } else {
          params.resource = 'metals.t1';
          params.targetRatePerMin = 10;
        }
      } else if (goal === 'secure_power') {
        const arg1 = a[2];
        if (arg1 !== undefined) {
          const num1 = Number(arg1);
          params.targetNetEnergyPerS = !isNaN(num1) ? num1 : 10;
        } else {
          params.targetNetEnergyPerS = 10;
        }
      }
      const r = await sim(ctx, 'queueGoal', { goal, params });
      return `goal ${goal} queued${tickSuffix(r)}`;
    }
    if (sub === 'cancel') {
      const goalId = a[1];
      if (!goalId) {
        throw new Error('usage: goal cancel <goalId>');
      }
      const r = await sim(ctx, 'cancelGoal', { goalId });
      return `goal ${goalId} cancelled${tickSuffix(r)}`;
    }
    if (sub === 'clear') {
      const r = await sim(ctx, 'dev.goal', { op: 'clear' });
      return `goals cleared${tickSuffix(r)}`;
    }
    throw new Error(`unknown goal subcommand '${a[0]}'. Usage: ${goalCommand.help}`);
  },
};

function resolveDecisionFromColony(
  col: (ViewColony & { lastAutopilotDecision?: AutopilotDecision | null }) | undefined,
): Pick<AutopilotDecision, 'need' | 'weightedBp' | 'mode' | 'target' | 'lane'> | null {
  if (!col) return null;
  const d = col.lastAutopilotDecision;
  const stage = typeof col.stage === 'number' ? col.stage : d?.stage;
  const prio = col.priorities as Record<string, number> | undefined;
  const expPrio = prio?.expansion ?? 50;
  const powPrio = prio?.power ?? 50;
  const dMatchesStage = d && (d.stage === undefined || stage === undefined || d.stage === stage);
  const dMatchesPrio =
    d && (!prio || !d.priorities || (d.priorities.expansion === expPrio && d.priorities.power === powPrio));
  if (d && dMatchesStage && dMatchesPrio) {
    return d;
  }
  if (typeof stage !== 'number') {
    return d ?? null;
  }
  const need: NeedKey = stage <= 2 && expPrio > 50 && expPrio > powPrio ? 'expand' : 'energy';
  const rawBp = need === 'expand' ? 6500 : 6800;
  const sliderVal = need === 'expand' ? expPrio : powPrio;
  const weightedBp = Math.round(rawBp * (sliderVal / 50));
  const spec = NEED_AUTOMATION_TABLE[need];
  return {
    need,
    weightedBp,
    mode: resolveNeedMode(need, stage, true),
    target: spec.target,
    lane: spec.lane,
  };
}

export const autopilotCommand: DevCommandDef = {
  name: 'autopilot',
  help: 'autopilot [next]  Evaluate colony needs, weight by 5 priority sliders, and report or queue the next HQ autopilot decision',
  async run(a, ctx) {
    if (a[0] === 'help') {
      return autopilotCommand.help;
    }
    const r = await sim(ctx, 'dev.autopilot', { op: 'next' });
    const colonyIndex = ownColonyIndex(ctx.services);
    const view = getSimView(ctx);
    const col = viewColony(view, colonyIndex) as
      | (ViewColony & { lastAutopilotDecision?: AutopilotDecision | null })
      | undefined;
    const d = resolveDecisionFromColony(col);
    if (!d) {
      return `dev.autopilot ok${tickSuffix(r)}`;
    }
    const needText = `${d.need} (${d.weightedBp} bp)`;
    const targetText = `${d.target} (${d.lane})`;
    return `autopilot next: ${needText} -> ${d.mode}: ${targetText}`;
  },
};

export const stageDevCommands: DevCommandDef[] = [stageCommand, goalCommand, autopilotCommand];
