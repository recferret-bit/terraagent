// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TERRAIN, PREP, hexCount, hexIndex } from '@terra/sim';
import { extractModeFromArgv, isCombatTestExcludedFromBuild } from '../buildGate';
import { COMBAT_SPAWN_PRESETS } from '../catalog';
import { dispatchCombatTestSpawn } from '../panelActions';
import type { OnlineSession } from '../../../app/online/OnlineSession';
import { HudRoot } from '../../../core/hud/HudRoot';
import { defineFeature, type FeatureContext } from '../../../core/registry/types';
import { armyFeature } from '../../../features/army';
import { hudMinFeature } from '../../../features/hud-min';
import { territoryBorderFeature } from '../../../features/territory-border';

describe('combat-test water-safe fallback, preview gate parity & Faction Plate CSS invariants', () => {
  it('snaps Drop @ View Center (fallbackNear) from water to nearest dry passable tile while preserving direct-click coordinates', () => {
    const radius = 4;
    const count = hexCount(radius);
    const terrain = new Uint8Array(count).fill(TERRAIN.flat);
    const prep = new Uint8Array(count).fill(PREP.wild);
    const hx = hexIndex(radius);
    const centerIdx = hx.indexOf(0, 0);
    terrain[centerIdx] = TERRAIN.deep;
    const sent: Array<{ kind: string; args: Record<string, unknown> }> = [];
    const session = {
      store: {
        latest: { planet: { radius } },
        latestTiles: { terrain, prep },
      },
      commandBus: {
        send: vi.fn((kind: string, args: Record<string, unknown>) => {
          sent.push({ kind, args });
          return Promise.resolve({ ok: true });
        }),
      },
    } as unknown as OnlineSession;

    const tank = COMBAT_SPAWN_PRESETS.find((p) => p.id === 'demoTank')!;
    const hive = COMBAT_SPAWN_PRESETS.find((p) => p.id === 'hiveBlackAnt')!;

    dispatchCombatTestSpawn({ session, setStatus: vi.fn() }, {
      preset: tank, q: 0, r: 0, owner: 0, count: 1, insectAggressive: false, fallbackNear: false,
    });
    expect(sent[0]?.args).toMatchObject({ unit: 'demoTank', q: 0, r: 0 });

    dispatchCombatTestSpawn({ session, setStatus: vi.fn() }, {
      preset: tank, q: 0, r: 0, owner: 0, count: 1, insectAggressive: false, fallbackNear: true,
    });
    expect(sent[1]?.args.q === 0 && sent[1]?.args.r === 0).toBe(false);
    const snappedTankIdx = hx.indexOf(Number(sent[1]?.args.q), Number(sent[1]?.args.r));
    expect(terrain[snappedTankIdx]).toBe(TERRAIN.flat);

    dispatchCombatTestSpawn({ session, setStatus: vi.fn() }, {
      preset: hive, q: 0, r: 0, owner: 0, count: 1, insectAggressive: false, fallbackNear: true,
    });
    expect(sent[2]?.args.q === 0 && sent[2]?.args.r === 0).toBe(false);
  });

  it('keeps preview --mode development parity even when NODE_ENV=production is inherited', () => {
    const argv = ['node', 'vite', 'preview', '--mode', 'development'];
    expect(isCombatTestExcludedFromBuild({
      viteAppEnv: '',
      nodeEnv: 'production',
      mode: extractModeFromArgv(argv),
      argv,
    })).toBe(false);

    expect(isCombatTestExcludedFromBuild({
      viteAppEnv: '',
      nodeEnv: 'production',
      mode: undefined,
      argv: ['node', 'vite', 'preview'],
    })).toBe(true);
  });

  it('uses canonical --ta-* tokens without raw hex/rgba literals and preserves <=1100px / <=720px / <=640px responsive rules', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../combat-test.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\s*\(/i);
    expect(css).not.toMatch(/font-size:\s*10px/);
    expect(css).toContain('right: var(--ta-s3)');
    expect(css).toContain('@media (max-width: 1100px)');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('@media (max-width: 640px)');
  });
});

function mountCombatTestHudHarness(combatTest: boolean) {
  const flags = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W07']);
  const dockSample = defineFeature({
    id: 'construction-menu',
    wave: 'W01',
    hud: [{ id: 'construction', slot: 'bottom-left', mount: (el) => { el.textContent = 'build'; return { dispose() {} }; } }],
  });
  const colonySample = defineFeature({
    id: 'goals',
    wave: 'W01',
    hud: [{ id: 'goals-panel', slot: 'top-right', mount: (el) => { el.textContent = 'goals'; return { dispose() {} }; } }],
  });
  const rightSlotSample = defineFeature({
    id: 'chain-status',
    wave: 'W01',
    hud: [{ id: 'chain-status-hook', slot: 'top-right', mount: (el) => { el.textContent = 'chain'; return { dispose() {} }; } }],
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ctx: FeatureContext = {
    flags,
    host: 'local',
    services: { isCombatTest: () => combatTest, track: vi.fn() },
  };
  const hud = new HudRoot(
    host,
    [hudMinFeature, territoryBorderFeature, armyFeature, dockSample, colonySample, rightSlotSample],
    ctx,
  );
  return {
    host,
    ctx,
    hud,
    dispose: () => {
      hud.dispose();
      host.remove();
    },
  };
}

describe('combat-test HUD suppression', () => {
  it('hides CommandDock/ColonyBook, resource header bar, env panel, and border toggle only in combat-test mode', () => {
    const ct = mountCombatTestHudHarness(true);
    try {
      const rightSlot = ct.host.querySelector<HTMLElement>('[data-slot="top-right"]');
      expect(rightSlot?.hidden).toBe(true);
      expect(ct.host.querySelector('.ta-book')).toBeNull();
      expect(ct.host.querySelector('[data-panel="construction"]')).toBeNull();
      expect(ct.host.querySelector('[data-panel="goals-panel"]')).toBeNull();
      expect(ct.host.querySelector('[data-panel="chain-status-hook"]')).toBeNull();
      expect(ct.host.querySelector('[data-testid="hud-min"]')).toBeNull();
      expect(ct.host.querySelector('.ta-resources-hud')).toBeNull();
      expect(ct.host.querySelector('[data-testid="hud-env"]')).toBeNull();
      expect(ct.host.querySelector('.ta-env-panel')).toBeNull();
      expect(ct.host.querySelector('[data-testid="territory-border-hatch-toggle"]')).toBeNull();
      expect(ct.ctx.services.territoryBorder).toBeDefined();
      expect(ct.host.querySelector('[data-testid="army-stance-panel"]')).not.toBeNull();
      const toast = ct.ctx.services.hudMin?.showToast('Spawned', 'info');
      expect(toast?.textContent).toBe('Spawned');
      expect(ct.host.querySelector('[data-testid="hud-toast-container"]')?.children.length).toBe(1);
    } finally {
      ct.dispose();
    }

    const normal = mountCombatTestHudHarness(false);
    try {
      const rightSlot = normal.host.querySelector<HTMLElement>('[data-slot="top-right"]');
      expect(rightSlot?.hidden).toBe(false);
      expect(normal.host.querySelector('.ta-book')).not.toBeNull();
      expect(normal.host.querySelector('[data-testid="hud-min"]')).not.toBeNull();
      expect(normal.host.querySelector('[data-testid="hud-env"]')).not.toBeNull();
      expect(normal.host.querySelector('[data-testid="territory-border-hatch-toggle"]')).not.toBeNull();
    } finally {
      normal.dispose();
    }
  });
});
