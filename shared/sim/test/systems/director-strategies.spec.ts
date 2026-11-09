import { describe, expect, it } from 'vitest';
import { parseWaves, type DirectorRisk } from '@terra/contracts';
import { createPlanet, SimHost, compileData, dataRow } from '../../src';
import { applyDirectiveBatch, coreSkillAction, coreSkillLimits, previewBatch } from '../../src/systems/director';

const data = compileData(parseWaves('..16'));
const stocks = [{ id: 'metals.t1', unearmarked: 1000 }];
const risks: DirectorRisk[] = ['conservative', 'risky'];

function host(): SimHost {
  const sim = new SimHost({ flags: parseWaves('..16') });
  sim.load(createPlanet({ type: 'flat', seed: 'w16-core', radius: 8 }));
  sim.step(1);
  return sim;
}

describe('W16-36 core skill strategies', () => {
  it('accepts recovery, resources and power for both risk rows', () => {
    for (const risk of risks) {
      const limits = coreSkillLimits(risk, data);
      for (const skill of ['recovery', 'resources', 'power'] as const) {
        const action = coreSkillAction(skill, risk, data);
        const preview = previewBatch([action], stocks, limits);
        expect(preview.rejected, `${skill}/${risk}`).toEqual([]);
        expect(preview.accepted[0]?.kind).toBe('queueGoal');
      }
    }
    const conservative = coreSkillAction('resources', 'conservative', data);
    const risky = coreSkillAction('resources', 'risky', data);
    expect(conservative.kind === 'queueGoal' && risky.kind === 'queueGoal').toBe(true);
    if (conservative.kind === 'queueGoal' && risky.kind === 'queueGoal') {
      expect(conservative.args.budgetBp).toBe(dataRow(data, 'director', 'conservative').commitBp);
      expect(risky.args.budgetBp).toBe(dataRow(data, 'director', 'risky').commitBp);
    }
  });

  it('applies each profile through the ordinary goal handler', () => {
    for (const risk of risks) {
      const sim = host();
      const action = coreSkillAction('resources', risk, data);
      const acks = applyDirectiveBatch(sim.state, 0, [action], stocks, coreSkillLimits(risk, data), sim.tick);
      expect(acks).toEqual([{ actionId: action.actionId, state: 'applied' }]);
    }
  });
});
