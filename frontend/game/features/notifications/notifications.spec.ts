// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { AchievementToastHost } from '../achievements/toast';
import { DeedToastHost } from '../deed/deedNotifications';
import { GuildToastHost } from '../guild-toast/toast';
import { NearErrorToasts } from '../near-errors/toast';
import { XpToastHost } from '../xp/toast';
import {
  clearNotifications,
  getNotificationHistory,
  getUnreadNotificationCount,
  NotificationsPanel,
  pushNotification,
  resetNotificationsForTests,
} from './index';

describe('Notifications store & NotificationsPanel', () => {
  beforeEach(() => { resetNotificationsForTests(); document.body.replaceChildren(); });
  afterEach(() => { resetNotificationsForTests(); document.body.replaceChildren(); });

  it('records notifications, deduplicates by dedupeKey, filters by category, and invokes onSelect on click', () => {
    const badgeSpy = vi.fn();
    let arrivedCb: ((p: unknown) => void) | undefined;
    let departedCb: ((p: unknown) => void) | undefined;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ctx: FeatureContext = {
      flags: new Set(['W01', 'W15']),
      host: 'server',
      services: {
        track: () => {},
        setHudTabBadge: badgeSpy,
        store: {
          onGuildArrived: (cb) => { arrivedCb = cb as (p: unknown) => void; return () => {}; },
          onGuildDeparted: (cb) => { departedCb = cb as (p: unknown) => void; return () => {}; },
        },
      },
    };
    const panel = new NotificationsPanel(host, ctx);
    expect(host.querySelector('[data-testid="notifications-empty"]')?.hasAttribute('hidden')).toBe(false);
    arrivedCb?.({
      shipId: 'ship_1', npcId: 'npc_aurora', name: 'Aurora', departAt: Date.now() + 60_000,
      offers: [{ id: 'of_1', action: 'buy', resource: 'metals.t1', amount: 20, price: { token: 'USDC', amount: '1000000' }, remaining: 2 }],
    });
    expect(host.querySelector('[data-testid="notifications-guild-status"]')?.textContent).toBe('Aurora DOCKED');
    expect(getNotificationHistory()).toHaveLength(1);
    expect(getUnreadNotificationCount()).toBe(1);
    expect(badgeSpy).toHaveBeenLastCalledWith(host, 1);

    const jumpSpy = vi.fn();
    pushNotification({ category: 'combat', title: 'Colony Under Attack', message: 'Under attack at (4, -2)', dedupeKey: 'combat:1', onSelect: jumpSpy });
    pushNotification({ category: 'combat', title: 'Colony Under Attack', message: 'Under attack at (4, -2) [updated]', dedupeKey: 'combat:1', onSelect: jumpSpy });
    expect(getNotificationHistory()).toHaveLength(2);
    expect(host.querySelectorAll('[data-testid="notification-history-item"]')).toHaveLength(2);

    host.querySelector<HTMLButtonElement>('[data-testid="notifications-filter-combat"]')?.click();
    expect(host.querySelectorAll('[data-testid="notification-history-item"]')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('[data-testid="notification-history-click"]')?.click();
    expect(jumpSpy).toHaveBeenCalledTimes(1);
    expect(getUnreadNotificationCount()).toBe(1);
    host.querySelector<HTMLButtonElement>('[data-testid="notification-history-close"]')?.click();
    expect(getNotificationHistory()).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('[data-testid="notifications-filter-all"]')?.click();
    expect(host.querySelectorAll('[data-testid="notification-history-item"]')).toHaveLength(1);
    departedCb?.({ shipId: 'ship_1', npcId: 'npc_aurora' });
    expect(host.querySelector('[data-testid="notifications-guild-status"]')?.textContent).toBe('DEPARTED');
    clearNotifications();
    expect(getNotificationHistory()).toHaveLength(0);
    expect(badgeSpy).toHaveBeenLastCalledWith(host, null);
    panel.dispose();
  });
});

describe('Auto-dismissing & closeable toasts', () => {
  beforeEach(() => {
    resetNotificationsForTests();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetNotificationsForTests();
    document.body.replaceChildren();
  });

  it('auto-dismisses current toasts after timeout and supports closing via cross (×) button', () => {
    vi.useFakeTimers();

    // GuildToastHost: cross button + auto-dismiss
    const gHost = document.createElement('div');
    document.body.appendChild(gHost);
    const gToast = new GuildToastHost(gHost, { enabled: () => true, openTrade: () => {} });
    gToast.arrive({ shipId: 's1', npcId: 'Vega', name: 'Vega', offers: [], departAt: 1000 });
    const gRoot = gHost.querySelector<HTMLElement>('[data-testid="guild-toasts"]')!;
    expect(gRoot.hidden).toBe(false);
    gHost.querySelector<HTMLButtonElement>('[data-testid="guild-toast-close"]')?.click();
    expect(gRoot.hidden).toBe(true);

    gToast.arrive({ shipId: 's2', npcId: 'Sirius', name: 'Sirius', offers: [], departAt: 2000 });
    expect(gRoot.hidden).toBe(false);
    vi.advanceTimersByTime(8100);
    expect(gRoot.hidden).toBe(true);
    gToast.dispose();

    // DeedToastHost: cross button + auto-dismiss
    const dHost = document.createElement('div');
    document.body.appendChild(dHost);
    const dToast = new DeedToastHost(dHost);
    dToast.show({
      tokenId: 'deed:col_0',
      colonyId: 'col_0',
      version: 2,
      change: 'Stage 3',
      settled: false,
    });
    expect(dHost.hidden).toBe(false);
    expect(dHost.querySelector('[data-testid="deed-toast-close"]')).not.toBeNull();
    vi.advanceTimersByTime(6100);
    expect(dHost.hidden).toBe(true);
    dToast.dispose();

    // AchievementToastHost, XpToastHost & NearErrorToasts: cross buttons, auto-dismiss & history click
    const aHost = document.createElement('div');
    const xHost = document.createElement('div');
    const nHost = document.createElement('div');
    document.body.append(aHost, xHost, nHost);
    const openPlayerSpy = vi.fn();
    const aToast = new AchievementToastHost(aHost, { onOpenPlayer: openPlayerSpy });
    const xToast = new XpToastHost(xHost, { onOpenPlayer: openPlayerSpy });
    const nToast = new NearErrorToasts(nHost);
    aToast.show({ achievementId: 'a1', familyName: 'First Light', tierName: 'Bronze', xp: 50 });
    xToast.show({ level: 4, xp: 400, title: 'Vanguard' });
    nToast.show('NEAR_RELAY_FAILED');
    expect(aHost.hidden).toBe(false);
    expect(xHost.hidden).toBe(false);
    expect(nHost.hidden).toBe(false);
    expect(xHost.querySelector('[data-testid="xp-toast-close"]')).not.toBeNull();
    aHost.querySelector<HTMLButtonElement>('[data-testid="achievement-toast-close"]')?.click();
    nHost.querySelector<HTMLButtonElement>('[data-testid="near-toast-close"]')?.click();
    expect(aHost.hidden).toBe(true);
    expect(nHost.hidden).toBe(true);
    vi.advanceTimersByTime(6100);
    expect(xHost.hidden).toBe(true);
    const xpEntry = getNotificationHistory().find((e) => e.dedupeKey === 'xp-level:4');
    expect(xpEntry).toBeDefined();
    xpEntry?.onSelect?.();
    expect(openPlayerSpy).toHaveBeenCalledTimes(1);
    aToast.dispose();
    xToast.dispose();
    nToast.dispose();
  });
});
