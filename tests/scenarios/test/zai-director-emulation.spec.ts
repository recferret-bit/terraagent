import { describe, expect, it } from 'vitest';
import {
  CASES,
  DecisionSchema,
  loadTestEnv,
  parseDecisionJson,
  runEmulationCase,
} from '../../../scripts/dev/zai-emulation';

describe('NEAR.AI (z-ai/glm-5.3-flash) Strategic Director 10-Case Emulation Suite', () => {
  it('defines 10 distinct strategic decision scenarios across all categories', () => {
    expect(CASES).toHaveLength(10);

    const categories = new Set(CASES.map((c) => c.category));
    expect(categories.has('what_to_build')).toBe(true);
    expect(categories.has('where_to_go')).toBe(true);
    expect(categories.has('what_to_do')).toBe(true);

    const buildCases = CASES.filter((c) => c.category === 'what_to_build');
    const moveCases = CASES.filter((c) => c.category === 'where_to_go');
    const actionCases = CASES.filter((c) => c.category === 'what_to_do');

    expect(buildCases.length).toBeGreaterThanOrEqual(3);
    expect(moveCases.length).toBeGreaterThanOrEqual(3);
    expect(actionCases.length).toBeGreaterThanOrEqual(3);
  });

  it('validates decision schema parser handles both pure JSON and markdown blocks', () => {
    const pureJson = JSON.stringify({
      actionKind: 'placeBuilding',
      category: 'what_to_build',
      target: 'wind_turbine',
      coordinates: { q: 1, r: 2 },
      harvestWeights: null,
      urgency: 'high',
      rationale: 'Grid power collapsed at dusk, wind turbine provides continuous night power.',
    });

    const parsedPure = parseDecisionJson(pureJson);
    expect(parsedPure.actionKind).toBe('placeBuilding');
    expect(parsedPure.target).toBe('wind_turbine');

    const fencedJson = `\`\`\`json\n${pureJson}\n\`\`\``;
    const parsedFenced = parseDecisionJson(fencedJson);
    expect(parsedFenced.actionKind).toBe('placeBuilding');
    expect(parsedFenced.target).toBe('wind_turbine');
  });

  it('rejects invalid or incomplete decision payloads', () => {
    const invalidJson = JSON.stringify({
      actionKind: 'invalidAction',
      target: '',
    });
    expect(() => parseDecisionJson(invalidJson)).toThrow();
  });

  it('handles exact boundary rationale length and zero coordinates', () => {
    const boundaryJson = JSON.stringify({
      actionKind: 'moveUnit',
      category: 'where_to_go',
      target: 'drone-01',
      coordinates: { q: 0, r: 0 },
      harvestWeights: { metals: 100, minerals: 0, bio: 0 },
      urgency: 'critical',
      rationale: '1234567890',
    });
    const parsed = parseDecisionJson(boundaryJson);
    expect(parsed.coordinates).toEqual({ q: 0, r: 0 });
    expect(parsed.rationale).toHaveLength(10);
  });

  it('exercises representative cases against NEAR.AI provider when live key is configured', async () => {
    const env = loadTestEnv();
    const apiKey = env.NEAR_AI_API_KEY || env.NEARAI_API_KEY || env.NEARAI_CLOUD_API_KEY;
    if (!apiKey || process.env.AI_LIVE !== '1') {
      // Offline fallback: verify schema validation on synthetic responses
      for (const c of CASES) {
        const synthetic = DecisionSchema.parse({
          actionKind: c.expectedActionKind,
          category: c.category,
          target: c.category === 'what_to_build' ? 'generator' : c.category === 'where_to_go' ? 'drone-01' : 'grow_economy',
          coordinates: c.category === 'where_to_go' ? { q: 0, r: 0 } : null,
          harvestWeights: c.expectedActionKind === 'setHarvestWeights' ? { metals: 70, minerals: 20, bio: 10 } : null,
          urgency: 'high',
          rationale: 'Synthetic offline test decision satisfying all constraints.',
        });
        expect(synthetic.category).toBe(c.category);
      }
      return;
    }

    // Run first 2 cases as live regression assertion
    const testCases = CASES.slice(0, 2);
    for (const c of testCases) {
      const res = await runEmulationCase(c, env);
      expect(res.decision).not.toBeNull();
      expect(res.decision?.actionKind).toBeDefined();
      expect(res.tokens.completion).toBeGreaterThan(0);
      expect(res.latencyMs).toBeGreaterThan(0);
      expect(res.passed).toBe(true);
    }
  }, 60000);
});
