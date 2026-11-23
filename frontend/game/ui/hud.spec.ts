// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FPS_LIMITS, getFpsCap, setFpsCap } from '@terra/render/core/perfConfig';
import { getShadowQuality, setShadowQuality } from '@terra/render/core/shadowQuality';
import { rememberSurface } from '../../design/analytics/context';
import { installUiActionDelegation, resetUiDelegationForTest } from '../../design/analytics/ui';
import { PauseOverlay } from '../app/online/PauseOverlay';
import { GameHud } from './hud';

const track = vi.fn();
vi.mock('../core/analytics', () => ({
  track: (...args: unknown[]) => track(...args),
  setConsent: vi.fn(),
  getConsent: () => true,
  flush: async () => undefined,
}));

describe('GameHud pause controls analytics', () => {
  beforeEach(() => {
    track.mockClear();
    document.body.innerHTML = '';
    localStorage.clear();
    setFpsCap(0);
    resetUiDelegationForTest();
    rememberSurface('play');
    installUiActionDelegation('play');
  });

  afterEach(() => {
    resetUiDelegationForTest();
    setFpsCap(0);
    setShadowQuality('auto');
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('emits pause_fps_cap once per click across all [data-fps-cap] buttons and syncs FPS cap state', () => {
    const hud = new GameHud(document.body, 'Dune', 7, { onResume: () => {}, onReturn: () => {} });
    hud.setPaused(true);

    for (const cap of FPS_LIMITS) {
      const btn = hud.pause.querySelector<HTMLButtonElement>(`[data-fps-cap="${cap}"]`)!;
      btn.click();
      expect(getFpsCap()).toBe(cap);
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    }

    expect(track.mock.calls).toEqual(
      FPS_LIMITS.map((cap) => [
        'ui_action_clicked',
        { surface: 'play', area: 'settings', action: 'pause_fps_cap', target: String(cap), runtime: 'local' },
      ]),
    );
    hud.dispose();
  });

  it('emits pause_resume and pause_return_orbit once per click (including child spans) and invokes callbacks', () => {
    let resumed = 0;
    let returned = 0;
    let hud: GameHud | null = null;
    hud = new GameHud(document.body, 'Dune', 7, {
      onResume: () => {
        resumed += 1;
        hud?.setPaused(false);
      },
      onReturn: () => {
        returned += 1;
        hud?.dispose();
      },
    });
    hud.setPaused(true);

    const resumeBtn = hud.pause.querySelector<HTMLButtonElement>('#p-resume')!;
    const innerSpan = document.createElement('span');
    innerSpan.textContent = 'Resume';
    resumeBtn.replaceChildren(innerSpan);
    innerSpan.click();
    expect(resumed).toBe(1);
    expect(hud.paused).toBe(false);

    hud.setPaused(true);
    hud.pause.querySelector<HTMLButtonElement>('#p-return')!.click();
    expect(returned).toBe(1);

    expect(track.mock.calls).toEqual([
      ['ui_action_clicked', { surface: 'play', area: 'settings', action: 'pause_resume', runtime: 'local' }],
      ['ui_action_clicked', { surface: 'play', area: 'settings', action: 'pause_return_orbit', runtime: 'local' }],
    ]);
  });
});

describe('PauseOverlay and disabled control analytics', () => {
  beforeEach(() => {
    track.mockClear();
    document.body.innerHTML = '';
    localStorage.clear();
    setFpsCap(0);
    setShadowQuality('auto');
    resetUiDelegationForTest();
    rememberSurface('play');
    installUiActionDelegation('play');
  });

  afterEach(() => {
    resetUiDelegationForTest();
    setFpsCap(0);
    setShadowQuality('auto');
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('emits single events for online PauseOverlay controls and ignores non-controls or disabled clicks', () => {
    const hud = new GameHud(document.body, 'Dune', 7, { onResume: () => {}, onReturn: () => {} });
    hud.setPaused(true);
    hud.pause.querySelector<HTMLElement>('h2')!.click();
    hud.el.querySelector<HTMLElement>('#chip-metals')!.click();
    const resumeBtn = hud.pause.querySelector<HTMLButtonElement>('#p-resume')!;
    resumeBtn.disabled = true;
    const child = document.createElement('span');
    resumeBtn.appendChild(child);
    child.click();
    expect(track).not.toHaveBeenCalled();
    hud.dispose();

    const pause = new PauseOverlay(document.body, { onResume: () => {}, onReturnToOrbit: () => {} });
    pause.setPaused(true);
    pause.el.querySelector<HTMLButtonElement>('[data-fps-cap="60"]')!.click();
    pause.el.querySelector<HTMLButtonElement>('[data-shadow-quality="low"]')!.click();
    expect(getShadowQuality()).toBe('low');
    pause.el.querySelector<HTMLButtonElement>('[data-testid="pause-resume"]')!.click();
    pause.setPaused(true);
    pause.el.querySelector<HTMLButtonElement>('[data-testid="pause-return-orbit"]')!.click();
    expect(track.mock.calls).toEqual([
      ['ui_action_clicked', { surface: 'play', area: 'settings', action: 'pause_fps_cap', target: '60', runtime: 'local' }],
      ['ui_action_clicked', { surface: 'play', area: 'settings', action: 'pause_shadows', target: 'low', runtime: 'local' }],
      ['ui_action_clicked', { surface: 'play', area: 'settings', action: 'pause_resume', runtime: 'local' }],
      ['ui_action_clicked', { surface: 'play', area: 'settings', action: 'pause_return_orbit', runtime: 'local' }],
    ]);
    pause.dispose();
  });
});
