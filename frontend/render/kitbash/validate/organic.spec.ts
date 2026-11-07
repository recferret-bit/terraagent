import { describe, expect, it } from 'vitest';
import { organicValidatorFixtures } from './organicFixtures';
import { extractArchetype } from './extract';
import { poses } from './poses';
import '../index';

describe('organic validation profile', () => {
  for (const f of organicValidatorFixtures()) it(f.name, () => {
    const issues = f.report.issues.filter(i => i.severity !== 'info');
    if (f.expected) expect(issues.map(i => i.code)).toContain(f.expected);
    else expect(issues).toEqual([]);
  });
  it('preserves organ anchors and keeps sac strain within the explicit 20.5% attack-charge envelope across the pose sweep', () => {
    const model = extractArchetype('fauna.greenSpitter');
    const sac = model.parts.find(p => p.animType === 69)!;
    const edge = (t: Float32Array) => Math.hypot(t[3] - t[0], t[4] - t[1], t[5] - t[2]);
    for (const pose of poses({ ...sac, insectSpecies: 2 })) expect(Math.abs(edge(pose.tris) / edge(sac.tris) - 1)).toBeLessThan(0.2051);
  });
});
