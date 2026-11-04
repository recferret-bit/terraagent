import { describe, expect, it } from 'vitest';
import { selectDirectorSkills, strategyPermitted } from '../../src/systems/director';

const waves = new Set(['W00', 'W08', 'W16', 'W18']);
const none = { raids: false, upgrades: false, launch: false };

describe('W16-38 strategy permissions', () => {
  it('omits diplomacy without an executor, and technology and settlement without their waves', () => {
    const ids = selectDirectorSkills({ waves, stage: 5 }).map((skill) => skill.id);
    expect(ids).not.toContain('diplomacy');
    expect(ids).not.toContain('technology');
    expect(ids).not.toContain('settlement');
  });

  it('keeps a raid behind the raids flag', () => {
    expect(strategyPermitted('diplomacy', { raids: false, upgrades: true, launch: true })).toBe(false);
    expect(strategyPermitted('diplomacy', { raids: true, upgrades: false, launch: false })).toBe(true);
  });

  it('keeps an upgrade behind the upgrades flag', () => {
    expect(strategyPermitted('technology', { raids: true, upgrades: false, launch: true })).toBe(false);
    expect(strategyPermitted('technology', { raids: false, upgrades: true, launch: false })).toBe(true);
  });

  it('keeps a launch behind the launch flag', () => {
    expect(strategyPermitted('settlement', { raids: true, upgrades: true, launch: false })).toBe(false);
    expect(strategyPermitted('settlement', { raids: false, upgrades: false, launch: true })).toBe(true);
  });

  it('denies raid, upgrade and launch when every flag is off', () => {
    expect(strategyPermitted('diplomacy', none)).toBe(false);
    expect(strategyPermitted('technology', none)).toBe(false);
    expect(strategyPermitted('settlement', none)).toBe(false);
  });
});
