// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isProductionBuild, setProductionBuildOverride } from '@terra/render/ui/buildEnv';
import { disposeCrt, initCrt } from '@terra/render/ui/crt';
import { initPixelDialog, togglePixelDialog } from '@terra/render/ui/pixelDialog';
import { setProductionBuildOverride as setGameProductionBuildOverride } from '../buildEnv';
import { devConsoleEnabled, mountDevConsole } from '../../dev/console';
import combatTuningFeature from '../../features/combat-tuning';
import deedFeature from '../../features/deed';
import identityFeature from '../../features/identity';
import { NeighborHudStrip } from '../../features/maps/NeighborHudStrip';
import notificationsFeature from '../../features/notifications';
import {
  getNotificationHistory,
  getUnreadNotificationCount,
  pushNotification,
  resetNotificationsForTests,
} from '../../features/notifications/notificationStore';
import {
  getSharedAutopilotState,
  patchSharedAutopilotState,
  resetSharedAutopilotStateForTests,
} from '../../features/shared/aiAutopilotState';
import stagesFeature from '../../features/stages';
import territoryBorderFeature from '../../features/territory-border';
import tradeHubFeature from '../../features/trade-hub';
import { CargoToastController } from '../../features/trade-hub/cargoUx';
import { defineFeature, type FeatureContext } from '../registry/types';
import { HudRoot } from './HudRoot';

describe('Production vs Local build gating & VITE_APP_ENV precedence', () => {
  beforeEach(() => {
    setProductionBuildOverride(null);
    setGameProductionBuildOverride(null);
    resetSharedAutopilotStateForTests();
    resetNotificationsForTests();
    document.body.replaceChildren();
  });

  afterEach(() => {
    setProductionBuildOverride(null);
    setGameProductionBuildOverride(null);
    resetSharedAutopilotStateForTests();
    resetNotificationsForTests();
    document.body.replaceChildren();
  });

  it('honors explicit VITE_APP_ENV over Vite MODE and PROD fallback', () => {
    expect(isProductionBuild('development', false, 'production')).toBe(true);
    expect(isProductionBuild('development', false, 'prod')).toBe(true);
    expect(isProductionBuild('production', true, 'development')).toBe(false);
    expect(isProductionBuild('production', true, 'local')).toBe(false);
    expect(isProductionBuild('production', false, undefined)).toBe(true);
    expect(isProductionBuild('development', true, undefined)).toBe(false);
  });

  it('disables ` console, hides shader buttons (#fx-bar & pixelDialog), hides BORDER: SOLID, and removes COMBAT LAB on production', () => {
    setProductionBuildOverride(true);
    setGameProductionBuildOverride(true);

    const canvasHost = document.createElement('div');
    document.body.appendChild(canvasHost);
    initCrt([canvasHost]);
    initPixelDialog();
    togglePixelDialog(true);
    expect(document.getElementById('fx-bar')).toBeNull();
    expect(document.getElementById('crt-switch')).toBeNull();
    expect(document.getElementById('pixel-switch')).toBeNull();
    expect(document.getElementById('shadow-switch')).toBeNull();
    expect(document.getElementById('pixel-tune')).toBeNull();
    expect(document.getElementById('pixel-dialog')).toBeNull();
    disposeCrt();

    expect(devConsoleEnabled('?dev=1', true, 'development')).toBe(false);
    const con = mountDevConsole({
      parent: document.body,
      features: [],
      ctx: { flags: new Set(['W00']), host: 'server', services: { track: () => {} } },
    });
    expect(con.console).toBeNull();
    con.dispose();

    const borderEl = document.createElement('div');
    const combatLabEl = document.createElement('div');
    document.body.append(borderEl, combatLabEl);
    const ctx: FeatureContext = {
      flags: new Set(['W02', 'W17']),
      host: 'server',
      services: { track: () => {} },
    };
    const bInst = territoryBorderFeature.hud![0]!.mount(borderEl, ctx);
    const cInst = combatTuningFeature.hud![0]!.mount(combatLabEl, ctx);
    expect(borderEl.querySelector('[data-testid="territory-border-hatch-toggle"]')).toBeNull();
    expect(borderEl.isConnected).toBe(false);
    expect(combatLabEl.querySelector('[data-testid="combat-tuning-toggle"]')).toBeNull();
    expect(combatLabEl.isConnected).toBe(false);
    bInst.dispose();
    cInst.dispose();

    // And in local/dev builds both controls mount normally:
    setProductionBuildOverride(false);
    setGameProductionBuildOverride(false);
    const devBorderEl = document.createElement('div');
    const devCombatEl = document.createElement('div');
    document.body.append(devBorderEl, devCombatEl);
    const bDev = territoryBorderFeature.hud![0]!.mount(devBorderEl, ctx);
    const cDev = combatTuningFeature.hud![0]!.mount(devCombatEl, ctx);
    expect(devBorderEl.querySelector('[data-testid="territory-border-hatch-toggle"]')?.textContent).toBe('BORDER: SOLID');
    expect(devCombatEl.querySelector('[data-testid="combat-tuning-toggle"]')).not.toBeNull();
    bDev.dispose();
    cDev.dispose();
  });
});

describe('HUD right-side consolidation, immediate dialogs & CommandDock preservation', () => {
  beforeEach(() => {
    resetSharedAutopilotStateForTests();
    resetNotificationsForTests();
    document.body.replaceChildren();
  });

  afterEach(() => {
    resetSharedAutopilotStateForTests();
    resetNotificationsForTests();
    document.body.replaceChildren();
  });

  it('opens Goals, Deed, Trade, and Player dialogs right away, clears spine active state on close, and preserves CommandDock on dialogOnly clicks', () => {
    const mockBuildFeature = defineFeature({
      id: 'construction-menu',
      wave: 'W01',
      hud: [
        {
          id: 'build',
          slot: 'bottom-right',
          order: 0,
          mount(el) {
            const card = document.createElement('div');
            card.dataset.testid = 'mock-build-card';
            el.appendChild(card);
            return { dispose: () => card.remove() };
          },
        },
      ],
    });
    const ctx: FeatureContext = {
      flags: new Set(['W01', 'W06', 'W08', 'W10', 'W20']),
      host: 'server',
      services: {
        track: () => {},
        session: { planetId: () => 'p1', colonyId: () => 'col_0' },
        pilot: {
          view: () => ({ isGuest: true, handle: 'guest_abcd1234', accountId: null, accessToken: '' }),
          subscribe: () => () => {},
          loginSocial: async () => {},
        },
      },
    };
    const root = new HudRoot(
      document.body,
      [mockBuildFeature, identityFeature, deedFeature, stagesFeature, tradeHubFeature, notificationsFeature],
      ctx,
    );

    const colonyBook = document.querySelector<HTMLElement>('[data-testid="colony-book"]')!;
    const commandDock = document.querySelector<HTMLElement>('[data-testid="command-dock"]')!;
    expect(colonyBook.dataset.side).toBe('right');
    expect(commandDock.getAttribute('data-collapsed')).toBe('false');

    // Clicking GOALS opens stage-track-hud immediately AND keeps CommandDock open
    const goalsTab = document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-goals"]')!;
    goalsTab.click();
    expect(document.querySelector<HTMLElement>('[data-testid="stage-track-hud"]')?.hidden).toBe(false);
    expect(commandDock.getAttribute('data-collapsed')).toBe('false');

    // Clicking DEED closes GOALS and opens deed-panel immediately
    const deedTab = document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-deed"]')!;
    deedTab.click();
    expect(document.querySelector<HTMLElement>('[data-testid="stage-track-hud"]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="deed-panel"]')?.getAttribute('data-open')).toBe('true');

    // Closing DEED via its CLOSE button clears the DEED spine highlight
    document.querySelector<HTMLButtonElement>('[data-testid="deed-close-btn"]')!.click();
    expect(deedTab.getAttribute('aria-selected')).toBe('false');

    // Clicking TRADE opens trade-hub-panel modal; clicking CLOSE clears TRADE spine highlight
    const tradeTab = document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-trade"]')!;
    tradeTab.click();
    expect(document.querySelector<HTMLElement>('[data-testid="trade-hub-panel"]')?.getAttribute('data-open')).toBe('true');
    document.querySelector<HTMLButtonElement>('[data-testid="trade-hub-close"]')!.click();
    expect(tradeTab.getAttribute('aria-selected')).toBe('false');

    // Clicking PLAYER opens pilot-dialog; clicking CLOSE clears PLAYER spine highlight
    const playerTab = document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-player"]')!;
    playerTab.click();
    expect(document.querySelector<HTMLElement>('[data-testid="pilot-dialog"]')?.getAttribute('data-open')).toBe('true');
    document.querySelector<HTMLButtonElement>('[data-testid="pilot-dialog-close"]')!.click();
    expect(playerTab.getAttribute('aria-selected')).toBe('false');

    // Clicking a drawer tab (NOTIFICATIONS) folds CommandDock so drawers never overlap
    document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-notifications"]')!.click();
    expect(commandDock.getAttribute('data-collapsed')).toBe('true');

    root.dispose();
  });
});

describe('HUD neighbor blocks, notifications & shared autopilot state', () => {
  beforeEach(() => {
    resetSharedAutopilotStateForTests();
    resetNotificationsForTests();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSharedAutopilotStateForTests();
    resetNotificationsForTests();
    document.body.replaceChildren();
  });

  it('renders players list below minimap with each player in a single standalone block', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const onSelect = vi.fn();
    const strip = new NeighborHudStrip({
      container: slot,
      ctx: {
        flags: new Set(['W11']),
        host: 'server',
        services: { track: () => {}, colonyId: 0, focusTile: onSelect },
      },
    });
    strip.update({
      tick: 100,
      colonies: [
        { index: 0, id: 'c0', name: 'My Colony', status: 'active', q: 0, r: 0 },
        { index: 1, id: 'c1', name: 'Valkyrie', status: 'active', q: 12, r: -4, discovered: true },
        { index: 2, id: 'c2', name: 'google-oauth2-1069208173371956-2', status: 'active', q: -8, r: 10, discovered: true },
      ],
      blobs: { diplomacy: { contacts: [1, 2] } },
    });
    const items = slot.querySelectorAll<HTMLElement>('.ta-neighbor-hud-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.classList.contains('plate-sm')).toBe(true);
    expect(items[0]?.dataset.testid).toBe('neighbor-marker-c1');
    expect(items[1]?.querySelector('[data-testid="neighbor-name"]')?.textContent).toBe('Pilot #1956');
    expect(slot.querySelector<HTMLElement>('[data-testid="minimap-neighbor-markers"]')?.hidden).toBe(true);
    items[0]?.click();
    expect(onSelect).toHaveBeenCalledWith(12, -4);
    strip.dispose();
  });

  it('auto-dismisses cargo toast by time, closes on click, and records clickable notification history', () => {
    vi.useFakeTimers();
    const openTrade = vi.fn();
    const panelToast = document.createElement('div');
    const floatingToast = document.createElement('div');
    document.body.append(panelToast, floatingToast);
    const toastCtrl = new CargoToastController(panelToast, floatingToast, openTrade);
    toastCtrl.notifyError('insufficient_stock');
    expect(floatingToast.hidden).toBe(false);
    expect(getNotificationHistory()[0]?.title).toBe('Cargo Alert');
    getNotificationHistory()[0]?.onSelect?.();
    expect(openTrade).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(8100);
    expect(floatingToast.hidden).toBe(true);

    toastCtrl.notifyRefund(40, 'metals.t1');
    expect(floatingToast.hidden).toBe(false);
    floatingToast.click();
    expect(floatingToast.hidden).toBe(true);
    toastCtrl.dispose();
  });

  it('marks unread notifications read via MARK READ and synchronizes shared autopilot state', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const inst = notificationsFeature.hud![0]!.mount(host, {
      flags: new Set(['W10']),
      host: 'server',
      services: { track: () => {} },
    });
    pushNotification({ category: 'system', title: 'Alert', message: 'Reactor online' });
    expect(getUnreadNotificationCount()).toBe(1);
    host.querySelector<HTMLButtonElement>('[data-testid="notifications-mark-read"]')!.click();
    expect(getUnreadNotificationCount()).toBe(0);
    expect(getNotificationHistory()).toHaveLength(1);
    inst.dispose();

    expect(getSharedAutopilotState()).toEqual({ aiEnabled: false, awayRaids: false, mode: 'director' });
    patchSharedAutopilotState({ aiEnabled: true, awayRaids: true, mode: 'rules_only' });
    expect(getSharedAutopilotState()).toEqual({ aiEnabled: true, awayRaids: true, mode: 'rules_only' });
  });
});
