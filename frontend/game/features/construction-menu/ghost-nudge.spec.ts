// @vitest-environment jsdom
import { DEPOSIT, PREP, TERRAIN, hexCount, hexIndex } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { ConstructionMenu } from './ConstructionMenu';

function createPlanetView(radius = 5) {
  const count = hexCount(radius);
  const terrain = new Uint8Array(count).fill(TERRAIN.flat);
  const prep = new Uint8Array(count).fill(PREP.wild);
  const deposit = new Uint8Array(count);
  const height = new Float32Array(count);
  const owner = new Int8Array(count);
  const hIndex = hexIndex(radius);

  return {
    view: {
      planet: { id: 'test', type: 'desert' as const, radius },
      tiles: { count, terrain, prep, deposit, height, owner },
      colonies: [{ index: 0 }],
    } as unknown as GameView,
    setDeposit(q: number, r: number, val: number) {
      const idx = hIndex.indexOf(q, r);
      if (idx >= 0) deposit[idx] = val;
    },
  };
}

describe('Command Hub 3x3 anchor nudge & first-click retry rollback', () => {
  it('nudges a 3x3 Command Hub hovered next to a deposit so first-click placement succeeds', () => {
    const { view, setDeposit } = createPlanetView(5);
    setDeposit(1, 0, DEPOSIT.metals);
    const parent = document.createElement('div');
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const ctx = {
      flags: new Set(['W00', 'W01', 'W02', 'W05']),
      host: 'server' as const,
      services: { sendCommand, track: vi.fn() },
    } as unknown as FeatureContext;

    const menu = new ConstructionMenu(parent, ctx, view);
    menu.startPlacement('commandHub');
    // (0, 0) itself has no deposit, but its +q neighbor corner (1, 0) hits metals deposit.
    // Nudging anchor 1 hex (-1, 0) keeps (0, 0) covered inside the 3x3 footprint and lands cleanly!
    menu.setHoverTile(0, 0);
    const state = menu.getGhostState()!;
    expect(state.valid).toBe(true);
    expect(state.tiles.some((t) => t.q === 0 && t.r === 0)).toBe(true);
    expect(menu.confirm()).toBe(true);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    menu.dispose();
  });

  it('rolls back pendingIndices and re-arms ghost when sendCommand rejects (e.g. not_connected)', async () => {
    const { view } = createPlanetView(5);
    const parent = document.createElement('div');
    const showToast = vi.fn();
    const sendCommand = vi.fn().mockResolvedValue({ ok: false, code: 'not_connected', detail: 'no socket' });
    const ctx = {
      flags: new Set(['W00', 'W01', 'W02', 'W05']),
      host: 'server' as const,
      services: { sendCommand, track: vi.fn(), hudMin: { showToast } as any },
    } as unknown as FeatureContext;

    const menu = new ConstructionMenu(parent, ctx, view);
    menu.startPlacement('commandHub');
    menu.setHoverTile(0, 0);
    expect(menu.confirm()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(showToast).toHaveBeenCalled();
    expect(menu.getGhostState()?.building).toBe('commandHub');
    expect(menu.getGhostState()?.valid).toBe(true);
    expect([menu.getGhostState()?.q, menu.getGhostState()?.r]).toEqual([0, 0]);
    menu.dispose();
  });
});
