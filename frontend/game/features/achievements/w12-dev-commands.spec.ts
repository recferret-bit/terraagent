// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CommandRunner } from '../../dev/console/runner';
import achievementsFeature from './index';
import xpFeature from '../xp/index';

describe('W12-31 client dev console commands: fact, xp, profile', () => {
  it('fact add groundbreaker 100 triggers achievement toast and xp add 5500 triggers level-up toast', async () => {
    const host = document.createElement('div');
    const devServer = vi.fn(async (name: string, body?: Record<string, unknown>) => {
      if (name === 'fact.add') {
        return {
          playerId: 'pr_dev_w12',
          family: body?.family,
          value: 100,
          unlocked: [
            {
              achievementId: 'groundbreaker',
              familyId: 'groundbreaker',
              familyName: 'Groundbreaker',
              tierName: 'Bronze',
              xp: 50,
            },
          ],
          levelUp: null,
        };
      }
      if (name === 'xp.add') {
        return {
          playerId: 'pr_dev_w12',
          delta: 5500,
          xp: 5500,
          level: 10,
          title: 'Grid Master',
          levelUp: { level: 10, previousLevel: 0, xp: 5500, title: 'Grid Master' },
        };
      }
      return { playerId: 'pr_dev_w12', reset: true };
    });

    const ctx = {
      flags: new Set(['W12']),
      host: 'server' as const,
      services: { devServer },
    };

    const achHud = achievementsFeature.hud?.find((h) => h.id === 'achievement-toast')?.mount(host, ctx as never);
    const xpHud = xpFeature.hud?.find((h) => h.id === 'xp-toast')?.mount(host, ctx as never);
    const runner = new CommandRunner([achievementsFeature, xpFeature], ctx as never);

    const res1 = await runner.run('fact add groundbreaker 100');
    expect(res1?.kind === 'text' && res1.text).toContain('fact groundbreaker = 100');
    expect(host.querySelector('[data-testid="achievement-toast"]')?.textContent).toContain(
      'Groundbreaker · Bronze (+50 XP)',
    );

    const res2 = await runner.run('xp add 5500');
    expect(res2?.kind === 'text' && res2.text).toContain('level 10');
    expect(host.querySelector('[data-testid="xp-level-up-toast"]')?.textContent).toContain(
      'Level 10 · Grid Master',
    );

    const res3 = await runner.run('profile reset');
    expect(res3?.kind === 'text' && res3.text).toContain('profile reset');
    expect(host.querySelector('[data-testid="achievement-toast"]')).toBeNull();

    achHud?.dispose?.();
    xpHud?.dispose?.();
  });
});
