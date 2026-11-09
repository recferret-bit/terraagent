import { describe, expect, it } from 'vitest';
import { parseWaves, type SectorAdvisorDirective } from '@terra/contracts';
import { createPlanet, ensureColonyRecord, SimHost } from '../../src';
import {
  applySectorDirectives,
  buildSectorAdvisorBrief,
  shouldRunSectorAdvisor,
  type SectorColonyMeta,
} from '../../src/systems/director/sector-advisor';

function createHost(): SimHost {
  const sim = new SimHost({ flags: parseWaves('..16') });
  sim.load(createPlanet({ type: 'flat', seed: 'sector-advisor-test', radius: 12 }));
  return sim;
}

function sampleDirective(colonyId: string): SectorAdvisorDirective {
  return {
    version: 1,
    sectorId: 'sector_alpha',
    advisorRationale: 'Acid rain inbound and green spitter swarm spotted. Fortify offline bases and shed power.',
    stewardshipDirectives: [
      {
        colonyId,
        action: 'fortify',
        priorityGoal: 'secure_power',
        rationale: 'Protect against impending acid storm and hostile swarm.',
      },
    ],
    faunaManagement: {
      threatLevel: 'severe',
      containmentHex: { q: 8, r: -3 },
      suggestedResponse: 'Deploy defense turrets at perimeter.',
    },
    disasterAdvisory: {
      shelterProtocol: true,
      powerGridLoadShedding: true,
      advisoryText: 'Acid rain active for 180s. Move worker drones inside shelter.',
    },
    tradeGuidance: {
      exportCommodity: 'bio.t1',
      importCommodity: 'metals.t1',
      routePriority: 'expedited',
    },
  };
}

describe('Sector Advisor System (Effective Batched Periodic AI Guidance)', () => {
  it('enforces advisor cadence cooldown and speeds up on critical threats', () => {
    const check1 = shouldRunSectorAdvisor(0, 100, false);
    expect(check1.shouldRun).toBe(false);
    expect(check1.reason).toBe('cooldown_active');
    expect(check1.nextRunSimS).toBe(300);

    const check2 = shouldRunSectorAdvisor(0, 305, false);
    expect(check2.shouldRun).toBe(true);
    expect(check2.reason).toBe('cadence_elapsed');

    const check3 = shouldRunSectorAdvisor(0, 130, true);
    expect(check3.shouldRun).toBe(true);
    expect(check3.reason).toBe('critical_threat');
  });

  it('builds a comprehensive batched sector brief covering offline players, fauna, disasters, and trade', () => {
    const sim = createHost();
    const brief = buildSectorAdvisorBrief(sim.state, 'sector_alpha', 600, 300, {
      fauna: [
        {
          swarmId: 'swarm-01',
          species: 'greenSpitter',
          count: 14,
          aggression: 'swarming',
          centerHex: { q: 8, r: -3 },
        },
      ],
      disasters: [
        {
          hazardId: 'hazard-01',
          type: 'acid_rain',
          intensity: 0.8,
          remainingDurationS: 180,
          affectedHexes: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
        },
      ],
      market: {
        highestDeficitResource: 'metals.t1',
        highestSurplusResource: 'bio.t1',
        activeTradeRoutes: 2,
      },
      diplomacy: [
        {
          colonyPair: ['col_0', 'col_1'],
          relation: 'neutral',
          borderTension: 25,
        },
      ],
    });

    expect(brief.version).toBe(1);
    expect(brief.sectorId).toBe('sector_alpha');
    expect(brief.colonies.length).toBeGreaterThanOrEqual(1);
    expect(brief.fauna).toHaveLength(1);
    expect(brief.disasters).toHaveLength(1);
    expect(brief.market.highestDeficitResource).toBe('metals.t1');
  });

  it('applies batched sector directives safely to colonies and disaster alerts', () => {
    const sim = createHost();
    const colonyId = sim.state.colonies[0]?.id ?? 'col_0';
    const directive = sampleDirective(colonyId);

    const res = applySectorDirectives(sim.state, directive);
    expect(res.coloniesUpdated).toBe(1);
    expect(res.shelterActive).toBe(true);
    expect(res.threatLevel).toBe('severe');
    expect((sim.state.colonies[0] as SectorColonyMeta).stewardshipAction).toBe('fortify');
  });

  it('ignores directives for unknown colonies and handles exact cadence boundary', () => {
    const sim = createHost();
    ensureColonyRecord(sim.state, 0, 0);
    const unknown = sampleDirective('col_999');
    const res = applySectorDirectives(sim.state, unknown);
    expect(res.coloniesUpdated).toBe(0);

    const exactNormal = shouldRunSectorAdvisor(100, 400, false, 300, 120);
    expect(exactNormal.shouldRun).toBe(true);
    const beforeBoundary = shouldRunSectorAdvisor(100, 399, false, 300, 120);
    expect(beforeBoundary.shouldRun).toBe(false);
  });
});
