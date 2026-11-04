import { describe, expect, it } from 'vitest';
import { directorSkillIds, selectDirectorSkills } from '../../src/systems/director';

const waves = new Set(['W00', 'W08', 'W16']);

describe('W16-35 skill selection', () => {
  it('offers only goals that have an executor, and at most six', () => {
    const selected = selectDirectorSkills({ waves, stage: 4 });
    const ids = selected.map((skill) => skill.id);
    expect(ids).toEqual(['recovery', 'resources', 'power']);
    expect(ids).not.toContain('defence');
    expect(ids).not.toContain('diplomacy');
    expect(selected.length).toBeLessThanOrEqual(6);
    expect(directorSkillIds()).toContain('diplomacy');
  });

  it('hides a skill the player denied and one whose wave is off', () => {
    const denied = selectDirectorSkills({ waves, stage: 4, deny: ['resources'] });
    expect(denied.map((skill) => skill.id)).toEqual(['recovery', 'power']);
    const early = selectDirectorSkills({ waves, stage: 0 });
    expect(early.map((skill) => skill.id)).toEqual(['recovery']);
    const allowed = selectDirectorSkills({ waves, stage: 4, allow: ['power'] });
    expect(allowed.map((skill) => skill.id)).toEqual(['power']);
  });

  it('keeps diplomacy out until its executor exists, even with W18 on', () => {
    const withWave = selectDirectorSkills({ waves: new Set([...waves, 'W18']), stage: 5 });
    expect(withWave.map((skill) => skill.id)).not.toContain('diplomacy');
  });
});
