// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGameInputBlocked, setGameInputBlocked } from '../../core/input/gameInputBlock';
import type { FeatureContext } from '../../core/registry/types';
import { HQ_RESPAWN_INPUT_SOURCE, HqRespawnModal } from './hqRespawnModal';

const modals: HqRespawnModal[] = [];
afterEach(() => {
  for (const m of modals.splice(0)) m.dispose();
  setGameInputBlocked(HQ_RESPAWN_INPUT_SOURCE, false);
  document.body.replaceChildren();
});

function make(closeHudMenus?: () => void): HqRespawnModal {
  const ctx = { flags: new Set<string>(), host: 'server', services: { track: () => {}, closeHudMenus } } as unknown as FeatureContext;
  const m = new HqRespawnModal(ctx, document.body);
  modals.push(m);
  return m;
}

describe('HQ respawn dialog: same scrim as the pause dialog, closes the HUD menus', () => {
  it('uses the shared scrim backdrop and box', () => {
    const m = make();
    expect(m.el!.classList.contains('ta-scrim')).toBe(true);
    expect(m.el!.querySelector('.ta-scrim__box')).not.toBeNull();
    expect(m.el!.querySelector('.ta-scrim__hazard')).not.toBeNull();
    expect(m.el!.querySelector('[data-testid=hq-respawn-title]')!.classList.contains('ta-scrim__title')).toBe(true);
  });

  it('closes every HUD menu once when it opens, not again while it stays open', () => {
    const close = vi.fn();
    const m = make(close);
    m.open({ q: 1, r: 2 });
    m.open({ q: 3, r: 4 });
    expect(close).toHaveBeenCalledTimes(1);
    expect([m.isOpen(), m.el!.dataset.open, isGameInputBlocked()]).toEqual([true, 'true', true]);
  });

  it('opens again after closing and calls the closer again; works without the service', () => {
    const close = vi.fn();
    const m = make(close);
    m.open({ q: 0, r: 0 });
    m.close();
    m.open({ q: 0, r: 0 });
    expect(close).toHaveBeenCalledTimes(2);
    const bare = make(undefined);
    expect(() => bare.open({ q: 0, r: 0 })).not.toThrow();
    expect(bare.isOpen()).toBe(true);
  });
});
