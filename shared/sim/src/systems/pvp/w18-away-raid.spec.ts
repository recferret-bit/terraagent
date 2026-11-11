import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../data';
import { ensureColonyRecord } from '../../kernel/colonies';
import { createState } from '../../kernel/state';
import {
  applyAutopilot,
  awayPolicyRejectionCount,
  checkAiRaidAwayPolicy,
  openAwaySession,
  resetAwayPolicyRejections,
  resolveColonyAwayRaids,
} from '../away';

describe('W18-16 · AI raid awayPolicy routing (AW-11, D-17)', () => {
  const data = compileData(parseWaves('..18'));

  it('defaults awayRaids to false and rejects AI raid, enqueueTask(raid), and queueGoal(raid_target) with away_policy', () => {
    resetAwayPolicyRejections();
    const state = createState({
      planetId: 'p_w18_16',
      planetType: 'temperate',
      seed: 'w18-16-seed',
      radius: 24,
    });
    ensureColonyRecord(state, 0, 0);
    applyAutopilot(state, 0, {}, data, 0);
    openAwaySession(state, 0, 'col_0', { metals: 100, minerals: 100, bio: 100 }, 0);

    expect(resolveColonyAwayRaids(state, 0)).toBe(false);

    const r1 = checkAiRaidAwayPolicy(state, 0, {
      kind: 'raid',
      source: 'ai',
      args: { targetColonyIndex: 1 },
    });
    expect(r1).toEqual({ code: 'away_policy', detail: 'AW-11' });

    const r2 = checkAiRaidAwayPolicy(state, 0, {
      kind: 'enqueueTask',
      source: 'ai',
      args: { task: { kind: 'raid', targetColonyIndex: 1 } },
    });
    expect(r2).toEqual({ code: 'away_policy', detail: 'AW-11' });

    const r3 = checkAiRaidAwayPolicy(state, 0, {
      kind: 'queueGoal',
      source: 'ai',
      args: { goal: 'raid_target', params: { targetColonyId: 1 } },
    });
    expect(r3).toEqual({ code: 'away_policy', detail: 'AW-11' });
    expect(awayPolicyRejectionCount('AW-11')).toBe(3);
  });

  it('allows AI raid commands when awayRaids=true and always exempts player raids', () => {
    const state = createState({
      planetId: 'p_w18_16_allow',
      planetType: 'temperate',
      seed: 'w18-16-allow',
      radius: 24,
    });
    ensureColonyRecord(state, 0, 0);
    applyAutopilot(state, 0, {}, data, 0);
    openAwaySession(state, 0, 'col_0', { metals: 100, minerals: 100, bio: 100 }, 0);

    // Player raids are always exempt even when awayRaids=false
    expect(
      checkAiRaidAwayPolicy(state, 0, {
        kind: 'raid',
        source: 'player',
        args: { targetColonyIndex: 1 },
      }),
    ).toBeUndefined();

    // Opt in to awayRaids=true
    applyAutopilot(state, 0, { awayRaids: true }, data, 5);
    expect(resolveColonyAwayRaids(state, 0)).toBe(true);

    expect(
      checkAiRaidAwayPolicy(state, 0, {
        kind: 'raid',
        source: 'ai',
        args: { targetColonyIndex: 1 },
      }),
    ).toBeUndefined();
    expect(
      checkAiRaidAwayPolicy(state, 0, {
        kind: 'enqueueTask',
        source: 'ai',
        args: { raid: { targetColonyIndex: 1 } },
      }),
    ).toBeUndefined();
  });
});
