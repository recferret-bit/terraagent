import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseWaves, STAKING_TIERS, STAKING_RULES, MANAGED_AI_MODEL, SCRIPT_AI_MODEL } from '@terra/contracts';
import { compileData, createPlanet, SimHost } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { splitPlatformFee } from '../../src/near/infrastructure/network/protocol-fee.config';
import type { AiUsageSnapshot } from '../../src/near/staking/perks/ai-usage.reader';
import { EMPTY_AI_USAGE } from '../../src/near/staking/perks/ai-usage.reader';
import { resolvePerkLadder } from '../../src/near/staking/perks/legacy-ladder';
import { resolveLeadPatron } from '../../src/near/staking/perks/patron-resolver';
import { buildAiBudgetView, evaluatePerks, type PerksEvalInput } from '../../src/near/staking/perks/tier-engine';
import { nearToYocto } from '../../src/near/staking/yocto';

/**
 * W28-15 staking-no-p2w: `@terra/sim` is 100 % independent of stake (D-31, NEAR_STAKING_SPEC section 1). The W20 test of the
 * same name only proves the sim ignores a value nobody passes it; this one drives every staking path that could leak
 * (perks, tiers, managed-AI mode, market fee, patron seat, fee split) in lock-step with the sim ticks, for stakes across
 * 0..10^6 NEAR and tiers 0-4, and requires a byte-identical snapshot, plus a static guard over the sim source tree.
 */
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const DAY = 86_400_000;
const TICKS = 30;

/** Threshold edges (just below / on / just above every tier minimum) plus seeded random amounts up to 10^6 NEAR. */
function stakeAmounts(): Array<number | string> {
  const edges: Array<number | string> = [0, '0.000001', '9.999999', 10, '10.000001', '49.999999', 50, '199.999999', 200, '499.999999', 500, '500.000001', 1_000_000];
  let seed = 28_015;
  const next = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const random = Array.from({ length: 15 }, () => String(Math.floor(next() ** 2 * 1_000_000 * 100) / 100));
  return [...edges, ...random];
}

const USAGES: AiUsageSnapshot[] = [
  EMPTY_AI_USAGE,
  { ...EMPTY_AI_USAGE, freeTrialTurnsRemaining: STAKING_RULES.freeTrialTurns },
  { ...EMPTY_AI_USAGE, dailyCallsUsed: 9_999, activeAiColonySlots: 12 },
];

/** Every pure staking computation a request could run for a wallet staking `near` NEAR. Returns the tier reached. */
function runStakingPaths(near: number | string, tick: number): number {
  const yocto = BigInt(nearToYocto(near));
  const ladder = resolvePerkLadder({ w28: true, env: {} });
  let tier = 0;
  for (const sinceMs of [null, NOW, NOW - DAY, NOW - 8 * DAY]) {
    for (const usage of USAGES) {
      const input: PerksEvalInput = {
        ladder,
        activeStakedYocto: yocto,
        unbondingYocto: yocto / 3n,
        stakedSinceMs: sinceMs,
        lastStakedAtMs: sinceMs,
        nowMs: NOW + tick * 1_000,
        protocolAccountId: 'protocol.terraagent.mock',
        nearUsd: 0.5 + tick,
        dailyProtocolTradeFeeUsd: tick * 10,
        usage,
        leadPatronPlanetIds: [],
      };
      const perks = evaluatePerks(input);
      buildAiBudgetView(perks, usage, input.nearUsd);
      expect([MANAGED_AI_MODEL, SCRIPT_AI_MODEL]).toContain(perks.aiModel);
      tier = perks.tier;
    }
  }
  resolveLeadPatron([{ accountId: 'whale.near', activeStakedYocto: yocto, stakedSinceMs: NOW }], null);
  splitPlatformFee(yocto, { daoShareBp: 2_000, patronActive: true });
  return tier;
}

function runSim(hook?: (tick: number) => void): Uint8Array {
  const host = new SimHost({ flags: parseWaves('..20') });
  host.load(createPlanet({ type: 'temperate', seed: 'w28-15-no-p2w', radius: 14 }));
  host.submit({ colonyIndex: 0, source: 'system', commandId: 'spawn', kind: 'system.spawnColony', args: { colonyId: 'col_0', playerId: 'p_w28_15', name: 'No-P2W', q: 0, r: 0 } });
  for (let t = 0; t < TICKS; t++) {
    if (t === 4) host.submit({ colonyIndex: 0, source: 'player', commandId: 'land', kind: 'landPod', args: {} });
    if (t === 12) host.submit({ colonyIndex: 0, source: 'player', commandId: 'prio', kind: 'goals.setPriorities', args: { economy: 70, expansion: 30, defense: 50, power: 50, terraform: 50 } });
    hook?.(t);
    host.step(1);
  }
  return host.snapshot();
}

describe('W28-15 staking-no-p2w: the sim snapshot is identical for every stake', () => {
  const baseline = Buffer.from(runSim());

  it('covers all five tiers and the threshold edges', () => {
    const tiers = new Set(stakeAmounts().map((n) => runStakingPaths(n, 0)));
    expect([...tiers].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it.each(stakeAmounts().map((n) => [String(n)]))('stake %s NEAR: all staking paths run beside the sim, snapshot byte-identical', (near) => {
    const tablesBefore = JSON.stringify(compileData(parseWaves('all')).tables);
    const snapshot = runSim((tick) => runStakingPaths(near, tick));
    expect(Buffer.from(snapshot).equals(baseline)).toBe(true);
    expect(JSON.stringify(compileData(parseWaves('all')).tables)).toBe(tablesBefore);
  });

  it('the shared tier table the sim could import is frozen: no path can edit it in place', () => {
    expect(Object.isFrozen(STAKING_TIERS)).toBe(true);
    expect(STAKING_TIERS.every((r) => Object.isFrozen(r))).toBe(true);
    expect(Object.isFrozen(STAKING_RULES)).toBe(true);
  });
});

const SIM_SRC = resolve(import.meta.dirname, '../../../../shared/sim/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('W28-15 staking-no-p2w: static import guard over shared/sim', () => {
  const files = sourceFiles(SIM_SRC);

  it('scans the real tree (sanity)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('no sim source mentions staking, perks, tiers or stake clocks in code or imports', () => {
    const forbidden = /\b(staking|StakingTier|STAKING_(TIERS|RULES)|stakingTierFor|effectiveTakerFee|earlyExitFee|dailyAi(Budget|Call)|stakedNear|patronSeat|LeadPatron|perks)\b/i;
    const hits = files.filter((f) => forbidden.test(readFileSync(f, 'utf8'))).map((f) => f.slice(SIM_SRC.length));
    expect(hits).toEqual([]);
  });

  it('no sim source imports the backend, NEAR code or a contracts staking subpath', () => {
    const importRe = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
    const bad: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(importRe)) {
        const spec = m[1]!;
        if (/backend|near\/|\/staking|@terra\/contracts\/staking|@nestjs|near-api/.test(spec)) bad.push(`${f.slice(SIM_SRC.length)} -> ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('negative control: the guard regexes do catch a staking import', () => {
    const sample = "import { STAKING_TIERS } from '@terra/contracts/staking';";
    expect(/STAKING_(TIERS|RULES)/.test(sample)).toBe(true);
    expect(/@terra\/contracts\/staking/.test(sample)).toBe(true);
  });
});
