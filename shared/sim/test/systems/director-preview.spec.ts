import { describe, expect, it } from 'vitest';
import { parseWaves, type DirectiveAction } from '@terra/contracts';
import { compileData, dataRow } from '../../src/data';
import { previewBatch, type PreviewLimits } from '../../src/systems/director';

const metals = [{ id: 'metals.t1', unearmarked: 1000 }];

function limits(row: 'conservative' | 'risky', extra: Partial<PreviewLimits> = {}): PreviewLimits {
  const spec = dataRow(compileData(parseWaves('..16')), 'director', row);
  return {
    reserveFloorBp: spec.reserveFloorBp as number,
    commitBp: spec.commitBp as number,
    openGoalSlots: 2,
    awayRaids: false,
    ...extra,
  };
}

function goal(actionId: string, budgetBp: number, name: 'grow_economy' | 'raid_target' = 'grow_economy'): DirectiveAction {
  return { actionId, kind: 'queueGoal', args: { goal: name, budgetBp, params: { resource: 'metals.t1' } } };
}

describe('W16-11 cumulative batch preview', () => {
  it('does not let a second action reuse stock the first one committed', () => {
    const risky = limits('risky');
    const result = previewBatch([goal('a', 2000), goal('b', 2000)], metals, risky);
    expect(result.accepted.map((action) => action.actionId)).toEqual(['a']);
    expect(result.rejected).toEqual([{ actionId: 'b', reason: 'commit_cap' }]);
  });

  it('rejects a second goal when the free slot is already taken', () => {
    const result = previewBatch([goal('a', 0), goal('b', 0)], metals, limits('conservative', { openGoalSlots: 1 }));
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([{ actionId: 'b', reason: 'goal_slot' }]);
    expect(result.remainingSlots).toBe(0);
  });
});

describe('W16-11 risk does not bypass caps', () => {
  it('rejects a risky commitment above the risky row and a raid while away raids are off', () => {
    const over = previewBatch([goal('big', 5000)], metals, limits('risky'));
    expect(over.rejected).toEqual([{ actionId: 'big', reason: 'commit_cap' }]);
    const raid = previewBatch([goal('raid', 0, 'raid_target')], metals, limits('risky'));
    expect(raid.rejected).toEqual([{ actionId: 'raid', reason: 'away_raids' }]);
    const allowed = previewBatch([goal('ok', 1000)], metals, limits('conservative'));
    expect(allowed.accepted).toHaveLength(1);
    expect(allowed.rejected).toEqual([]);
  });

  it('keeps a locked goal when the batch tries to cancel it', () => {
    const cancel: DirectiveAction = { actionId: 'c', kind: 'cancelGoal', args: { goalId: 'goal_locked' } };
    const result = previewBatch([cancel], metals, limits('risky', { protectedGoalIds: ['goal_locked'] }));
    expect(result.rejected).toEqual([{ actionId: 'c', reason: 'locked_goal' }]);
  });
});
