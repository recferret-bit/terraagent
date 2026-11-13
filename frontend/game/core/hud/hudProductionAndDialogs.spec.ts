// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProductionBuildOverride } from '@terra/render/ui/buildEnv';
import { disposeCrt, initCrt } from '@terra/render/ui/crt';
import { setProductionBuildOverride as setGameProductionBuildOverride } from '../buildEnv';
import { devConsoleEnabled, mountDevConsole } from '../../dev/console';
import combatTuningFeature from '../../features/combat-tuning';
import deedFeature from '../../features/deed';
import identityFeature from '../../features/identity';
import { NeighborHudStrip } from '../../features/maps/NeighborHudStrip';
import {
  getSharedAutopilotState,
  patchSharedAutopilotState,
  resetSharedAutopilotStateForTests,
} from '../../features/shared/aiAutopilotState';
import stagesFeature from '../../features/stages';
import territoryBorderFeature from '../../features/territory-border';
import tradeHubFeature from '../../features/trade-hub';
import type { FeatureContext } from '../registry/types';
import { HudRoot } from './HudRoot';

describe('Production vs Local build gating & HUD consolidation', () => {
  beforeEach(() => {
    setProductionBuildOverride(null);
    setGameProductionBuildOverride(null);
    resetSharedAutopilotStateForTests();
    document.body.replaceChildren();
  });

  afterEach(() => {
    setProductionBuildOverride(null);
    setGameProductionBuildOverride(null);
    resetSharedAutopilotStateForTests();
    document.body.replaceChildren();
  });

  it('disables ` console, hides shader buttons (#fx-bar), hides BORDER: SOLID, and removes COMBAT LAB on production', () => {
    setProductionBuildOverride(true);
    setGameProductionBuildOverride(true);

    // 1. Shader / FX buttons (#fx-bar) are not mounted on production
    const canvasHost = document.createElement('div');
    document.body.appendChild(canvasHost);
    initCrt([canvasHost]);
    expect(document.getElementById('fx-bar')).toBeNull();
    expect(document.getElementById('crt-switch')).toBeNull();
    expect(document.getElementById('pixel-switch')).toBeNull();
    expect(document.getElementById('shadow-switch')).toBeNull();
    expect(document.getElementById('pixel-tune')).toBeNull();
    disposeCrt();

    // 2. Backtick console is disabled on production
    expect(devConsoleEnabled('?dev=1', true, 'development')).toBe(false);
    const con = mountDevConsole({
      parent: document.body,
      features: [],
      ctx: { flags: new Set(['W00']), host: 'server', services: { track: () => {} } },
    });
    expect(con.console).toBeNull();
    con.dispose();

    // 3. BORDER: SOLID and COMBAT LAB remove their elements on production
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
    expect(borderEl.querySelector('[data-testid="border-style-toggle"]')).toBeNull();
    expect(borderEl.isConnected).toBe(false);
    expect(combatLabEl.querySelector('[data-testid="combat-tuning-toggle"]')).toBeNull();
    expect(combatLabEl.isConnected).toBe(false);
    bInst.dispose();
    cInst.dispose();
  });
});

describe('HUD right-side consolidation, immediate dialogs & neighbor blocks', () => {
  beforeEach(() => {
    resetSharedAutopilotStateForTests();
    document.body.replaceChildren();
  });

  afterEach(() => {
    resetSharedAutopilotStateForTests();
    document.body.replaceChildren();
  });

  it('combines CommandDock and ColonyBook on the right side and opens Goals, Deed, Trade, and Player dialogs right away', () => {
    const ctx: FeatureContext = {
      flags: new Set(['W06', 'W08', 'W10', 'W20']),
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
      [identityFeature, deedFeature, stagesFeature, tradeHubFeature],
      ctx,
    );

    const colonyBook = document.querySelector<HTMLElement>('[data-testid="colony-book"]')!;
    expect(colonyBook).not.toBeNull();
    expect(colonyBook.dataset.side).toBe('right');
    expect(colonyBook.closest('.ta-hud__slot')?.getAttribute('data-slot')).toBe('top-right');

    // Dialog-only panes are marked data-dialog-only="true"
    for (const id of ['player', 'deed', 'goals', 'trade']) {
      expect(colonyBook.querySelector(`[data-tab-pane="${id}"]`)?.getAttribute('data-dialog-only')).toBe('true');
    }

    // Clicking GOALS opens stage-track-hud immediately
    document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-goals"]')!.click();
    expect(document.querySelector<HTMLElement>('[data-testid="stage-track-hud"]')?.hidden).toBe(false);

    // Clicking DEED closes GOALS and opens deed-panel immediately
    document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-deed"]')!.click();
    expect(document.querySelector<HTMLElement>('[data-testid="stage-track-hud"]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="deed-panel"]')?.getAttribute('data-open')).toBe('true');

    // Clicking TRADE closes DEED and opens trade-hub-panel modal immediately
    document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-trade"]')!.click();
    expect(document.querySelector<HTMLElement>('[data-testid="deed-panel"]')?.getAttribute('data-open')).toBe('false');
    expect(document.querySelector<HTMLElement>('[data-testid="trade-hub-panel"]')?.getAttribute('data-open')).toBe('true');
    expect(document.querySelector<HTMLElement>('[data-testid="trade-hub-panel"]')?.getAttribute('data-modal')).toBe('true');

    // Clicking PLAYER closes TRADE and opens pilot-dialog immediately
    document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-player"]')!.click();
    expect(document.querySelector<HTMLElement>('[data-testid="trade-hub-panel"]')?.getAttribute('data-open')).toBe('false');
    expect(document.querySelector<HTMLElement>('[data-testid="pilot-dialog"]')?.getAttribute('data-open')).toBe('true');

    root.dispose();
  });
});

describe('HUD neighbor blocks & shared autopilot state', () => {
  beforeEach(() => {
    resetSharedAutopilotStateForTests();
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
        services: {
          track: () => {},
          colonyId: 0,
          focusTile: onSelect,
        },
      },
    });
    strip.update({
      tick: 100,
      colonies: [
        { index: 0, id: 'c0', name: 'My Colony', status: 'active', q: 0, r: 0 },
        { index: 1, id: 'c1', name: 'Valkyrie', status: 'active', q: 12, r: -4, discovered: true },
        { index: 2, id: 'c2', name: 'Ironclad', status: 'active', q: -8, r: 10, discovered: true },
      ],
      blobs: { diplomacy: { contacts: [1, 2] } },
    });
    const items = slot.querySelectorAll<HTMLElement>('.ta-neighbor-hud-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.classList.contains('plate-sm')).toBe(true);
    expect(items[0]?.dataset.testid).toBe('neighbor-marker-c1');
    items[0]?.click();
    expect(onSelect).toHaveBeenCalledWith(12, -4);
    strip.dispose();
  });

  it('synchronizes shared autopilot state between HQ AI, Director, and Away', () => {
    expect(getSharedAutopilotState()).toEqual({ aiEnabled: false, awayRaids: false, mode: 'director' });
    patchSharedAutopilotState({ aiEnabled: true, awayRaids: true, mode: 'rules_only' });
    expect(getSharedAutopilotState()).toEqual({ aiEnabled: true, awayRaids: true, mode: 'rules_only' });
  });
});
