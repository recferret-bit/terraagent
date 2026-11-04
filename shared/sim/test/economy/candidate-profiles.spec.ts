import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { applyPatchOps, compileData, defaultParamRegistry, tryCompileProfile, validatePatch } from '../../src';

const dir = resolve(import.meta.dirname, '../../../../tests/economy/profiles');
const load = (name: string): unknown => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const flags = parseWaves('..13');
const baseHash = compileData(new Set(flags.list), {}).hash;

describe('W13-43 regional specialization candidate profiles', () => {
  it('registers the prestige recipe fields as tunable parameters', () => {
    const r = defaultParamRegistry();
    for (const p of ['prestige.project.survey_array.cost', 'prestige.project.survey_array.buildS', 'prestige.transport.cargo.unitsPerBlock']) {
      expect(r.get(p)?.requiredWave).toBe('W13');
    }
  });

  it.each(['regional-specialist-desert.json', 'regional-specialist-ocean.json'])('%s validates against the registry and compiles to its own data hash', (file) => {
    const patch = load(file);
    expect(validatePatch({ parameters: {} }, patch, flags, { currentVersion: 1 })).toEqual([]);
    const parameters = applyPatchOps({ parameters: {} }, patch as never);
    const res = tryCompileProfile({ parameters }, flags.list);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.dataHash).not.toBe(baseHash);
    const rows = compileData(new Set(flags.list), res.compiled.overrides).tables.prestige as Record<string, { cost?: Record<string, number> }>;
    expect(Object.values(rows['project.survey_array']!.cost!).every((v) => v > 0)).toBe(true);
  });

  it('the two candidates differ from each other (a real specialization, not a copy)', () => {
    const cost = (f: string): unknown => {
      const res = tryCompileProfile({ parameters: applyPatchOps({ parameters: {} }, load(f) as never) }, flags.list);
      return res.ok ? (compileData(new Set(flags.list), res.compiled.overrides).tables.prestige as unknown as Record<string, { cost: unknown }>)['project.survey_array']!.cost : null;
    };
    expect(cost('regional-specialist-desert.json')).not.toEqual(cost('regional-specialist-ocean.json'));
  });
});
