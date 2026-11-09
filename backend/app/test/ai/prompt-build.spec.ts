import { AI_INPUT_TOKEN_CAP, AI_MAX_SKILLS } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { buildDirectorPrompt, type DirectorPromptSkill } from '../../src/ai/prompt/build';

function skills(count: number): DirectorPromptSkill[] {
  return Array.from({ length: count }, (_, index) => ({ id: `skill_${index}`, version: index + 1 }));
}

function built(offered: readonly DirectorPromptSkill[], briefJson: string) {
  const result = buildDirectorPrompt({ skills: offered, briefJson });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected a prompt');
  return result;
}

describe('W16-09 prompt skills and token cap', () => {
  it('keeps the first six skills in order', () => {
    const offered = skills(7);
    const result = built(offered, '{}');
    expect(AI_MAX_SKILLS).toBe(6);
    expect(result.skills).toEqual(offered.slice(0, 6));
    expect(result.skills.map((skill) => skill.id)).toEqual([
      'skill_0',
      'skill_1',
      'skill_2',
      'skill_3',
      'skill_4',
      'skill_5',
    ]);
  });

  it('publishes an object schema and leaves the brief out of the system text', () => {
    const brief = '{"colony":"c1"}';
    const left = built(skills(1), brief);
    const right = built(skills(2), '{"colony":"c2"}');
    expect(left.schema).toMatchObject({ type: 'object' });
    expect(left.user).toBe(brief);
    expect(left.system.includes(brief)).toBe(false);
    expect(left.system).toBe(right.system);
  });

  it('rejects a brief past the aggregate token cap', () => {
    const result = buildDirectorPrompt({
      skills: skills(7),
      briefJson: 'x'.repeat(AI_INPUT_TOKEN_CAP * 4 + 100),
    });
    expect(result).toEqual({ ok: false, code: 'context_too_large' });
  });

  it('accepts a small brief inside the cap', () => {
    const result = built(skills(2), '{}');
    const expected = Math.ceil((result.system.length + result.user.length + JSON.stringify(result.schema).length) / 4);
    expect(result.tokens).toBe(expected);
    expect(result.tokens).toBeLessThanOrEqual(AI_INPUT_TOKEN_CAP);
  });
});
