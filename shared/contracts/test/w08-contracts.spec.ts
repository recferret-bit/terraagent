import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  GOAL_KINDS,
  PRIORITY_KEYS,
  REJECT_CODES,
  STAGE_OVERRIDES,
  WaveId,
  acceptSuggestion,
  cancelGoal,
  commandDef,
  eventDef,
  goalDone,
  goalProgress,
  parseCommandArgs,
  parseWaves,
  queueGoal,
  reorderGoal,
  setPriorities,
  stageReached,
  stageUnlocked,
  suggestionOffered,
  type CommandKind,
  type EventKind,
} from '../src';

describe('W08-01 contracts: stage, goal & priority commands, events, and W08 flag', () => {
  it('registers all W08 commands with wave W08 and validates strict args', () => {
    expect(WaveId.safeParse('W08').success).toBe(true);
    expect(parseWaves('..08').has('W08')).toBe(true);
    expect(parseWaves('..07').has('W08')).toBe(false);

    const required: CommandKind[] = [
      'queueGoal',
      'cancelGoal',
      'reorderGoal',
      'acceptSuggestion',
      'setPriorities',
      'dev.stage',
      'dev.goal',
      'dev.autopilot',
    ];
    for (const k of required) {
      expect(COMMAND_KINDS).toContain(k);
      expect(commandDef(k).wave).toBe('W08');
    }

    expect(queueGoal.kind).toBe('queueGoal');
    expect(cancelGoal.kind).toBe('cancelGoal');
    expect(reorderGoal.kind).toBe('reorderGoal');
    expect(acceptSuggestion.kind).toBe('acceptSuggestion');
    expect(setPriorities.kind).toBe('setPriorities');

    expect(GOAL_KINDS).toContain('establish_colony');
    expect(GOAL_KINDS).toContain('grow_economy');
    expect(GOAL_KINDS).toContain('secure_power');
    expect(PRIORITY_KEYS).toEqual(['economy', 'expansion', 'defense', 'power', 'terraform']);
    expect(STAGE_OVERRIDES).toContain('fauna');

    expect(parseCommandArgs('queueGoal', { goal: 'establish_colony' }).success).toBe(true);
    expect(parseCommandArgs('queueGoal', { goal: 'grow_economy', params: { resource: 'metals.t1', targetRatePerMin: 10 }, budgetBp: 5000 }).success).toBe(true);
    expect(parseCommandArgs('queueGoal', { goal: 'secure_power', targetNetEnergyPerS: 10 }).success).toBe(true);
    expect(parseCommandArgs('queueGoal', { goal: 'nope' }).success).toBe(false);
    expect(parseCommandArgs('queueGoal', { goal: 'establish_colony', extra: 1 }).success).toBe(false);

    expect(parseCommandArgs('cancelGoal', { goalId: 'goal_1' }).success).toBe(true);
    expect(parseCommandArgs('cancelGoal', {}).success).toBe(false);

    expect(parseCommandArgs('reorderGoal', { goalId: 'goal_2', toIndex: 0 }).success).toBe(true);
    expect(parseCommandArgs('reorderGoal', { goalId: 'goal_2', direction: 'up' }).success).toBe(true);
    expect(parseCommandArgs('reorderGoal', { goalId: 'goal_2' }).success).toBe(false);

    expect(parseCommandArgs('acceptSuggestion', { suggestionId: 'sug_s0', stage: 0, goal: 'establish_colony' }).success).toBe(true);
    expect(parseCommandArgs('acceptSuggestion', {}).success).toBe(true);
    expect(parseCommandArgs('acceptSuggestion', { unknown: 1 }).success).toBe(false);

    expect(parseCommandArgs('setPriorities', { economy: 100, defense: 0 }).success).toBe(true);
    expect(parseCommandArgs('setPriorities', { priorities: { economy: 80, expansion: 40, defense: 20, power: 60, terraform: 50 } }).success).toBe(true);
    expect(parseCommandArgs('setPriorities', { economy: 150 }).success).toBe(false);
    expect(parseCommandArgs('setPriorities', { extra: 50 }).success).toBe(false);

    expect(parseCommandArgs('dev.stage', { op: 'set', stage: 4 }).success).toBe(true);
    expect(parseCommandArgs('dev.stage', { op: 'skip-dwell' }).success).toBe(true);
    expect(parseCommandArgs('dev.stage', { op: 'trigger', override: 'fauna' }).success).toBe(true);
    expect(parseCommandArgs('dev.stage', { op: 'trigger', override: 'unknown' }).success).toBe(false);

    expect(parseCommandArgs('dev.goal', { op: 'add', goal: 'grow_economy', resource: 'metals', targetRatePerMin: 10 }).success).toBe(true);
    expect(parseCommandArgs('dev.autopilot', { op: 'next' }).success).toBe(true);
  });

  it('registers all W08 events with wave W08 and validates event schemas', () => {
    const events: EventKind[] = [
      'stageReached',
      'stageUnlocked',
      'suggestionOffered',
      'goalProgress',
      'goalDone',
    ];
    for (const k of events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W08');
    }

    expect(stageReached.data.safeParse({ colonyIndex: 0, stage: 1, title: 'S1 First Light' }).success).toBe(true);
    expect(stageUnlocked.data.safeParse({ colonyIndex: 0, unlockStage: 2, buildings: ['pylon', 'depot'] }).success).toBe(true);
    expect(suggestionOffered.data.safeParse({ colonyIndex: 0, suggestionId: 'sug_0', stage: 0, goal: 'establish_colony' }).success).toBe(true);
    expect(goalProgress.data.safeParse({ colonyIndex: 0, goalId: 'goal_1', goal: 'establish_colony', status: 'active', progress: 0.5 }).success).toBe(true);
    expect(goalDone.data.safeParse({ colonyIndex: 0, goalId: 'goal_1', goal: 'establish_colony' }).success).toBe(true);
  });

  it('includes W08 reject codes stage_locked and goal_limit', () => {
    expect(REJECT_CODES).toEqual(expect.arrayContaining(['stage_locked', 'goal_limit']));
  });
});
