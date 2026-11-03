// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import achievementsFeature from './index';
import xpFeature from '../xp/index';

type ServerEventItem = { kind: string; data?: Record<string, unknown> };
type ServerEventEmit = (events: readonly ServerEventItem[]) => void;

describe('W12-27 in-game toasts for achievement earned and level up + /me HUD link', () => {
  it('renders achievement earned toast and level up toast from server events and links to /me.html#achievements', () => {
    const handlers: ServerEventEmit[] = [];
    const emitEvents: ServerEventEmit = (events) => {
      for (const fn of handlers) fn(events);
    };
    const ctx: FeatureContext = {
      flags: new Set(['W01', 'W12']),
      host: 'server',
      services: {
        track: () => undefined,
        store: {
          onServerEvents: (fn: ServerEventEmit) => {
            handlers.push(fn);
            return () => undefined;
          },
        } as never,
      },
    };

    const meEl = document.createElement('div');
    const achEl = document.createElement('div');
    const xpEl = document.createElement('div');

    const mePanel = achievementsFeature.hud?.[0]?.mount(meEl, ctx);
    const achPanel = achievementsFeature.hud?.[1]?.mount(achEl, ctx);
    const xpPanel = xpFeature.hud?.[0]?.mount(xpEl, ctx);

    const meLink = meEl.querySelector<HTMLAnchorElement>('[data-testid="hud-me-link"]');
    expect(meLink).not.toBeNull();
    expect(meLink?.getAttribute('href')).toBe('/me.html');

    emitEvents([
      {
        kind: 'achievement.earned',
        data: {
          achievementId: 'groundbreaker-2',
          familyId: 'groundbreaker',
          familyName: 'Groundbreaker',
          tierName: 'Silver',
          xp: 150,
        },
      },
      {
        kind: 'xp.levelUp',
        data: {
          level: 5,
          previousLevel: 4,
          xp: 1500,
          title: 'Surveyor',
        },
      },
    ]);

    const achToast = achEl.querySelector('[data-testid="achievement-toast"]');
    expect(achToast).not.toBeNull();
    expect(achToast?.textContent).toContain('Groundbreaker · Silver (+150 XP)');
    expect(achToast?.querySelector('a')?.getAttribute('href')).toBe('/me.html#achievements');

    const xpToast = xpEl.querySelector('[data-testid="xp-level-up-toast"]');
    expect(xpToast).not.toBeNull();
    expect(xpToast?.textContent).toContain('Level 5 · Surveyor (1500 XP)');
    expect(xpToast?.querySelector('a')?.getAttribute('href')).toBe('/me.html#achievements');

    mePanel?.dispose();
    achPanel?.dispose();
    xpPanel?.dispose();
  });
});
