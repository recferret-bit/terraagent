// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getFpsCap, setFpsCap, setShaderOptimized, setViewportPreset } from '@terra/render/core/perfConfig';
import { resolveInitialPixelArt } from '@terra/render/core/pixelArtPass';
import { getShadowQuality, setShadowQuality } from '@terra/render/core/shadowQuality';
import { resolveInitialCrt } from '@terra/render/ui/crt';
import { PauseOverlay } from '../app/online/PauseOverlay';
import { GameHud } from './hud';
import { MainMenu, type MenuCallbacks, type MenuSettings } from './menu';

function makeNoopCallbacks(overrides: Partial<MenuCallbacks> = {}): MenuCallbacks {
  return {
    onPlanet: () => {},
    onDeploy: () => {},
    onSettings: () => {},
    ...overrides,
  };
}

describe('Settings Modal (Esc key) & Live Pause FPS Cap', () => {
  afterEach(() => {
    setFpsCap(0);
    setShadowQuality('auto');
    localStorage.clear();
  });

  it('toggles Quality, Shader Optimizations, Max FPS, and Viewport settings on Escape and syncs with in-game PauseOverlay', () => {
    const root = document.createElement('div');
    const settingsUpdates: Array<{
      quality: string;
      optimized: boolean;
      resolution: string;
      fpsCap: number;
      bloom: boolean;
      skipCinematic: boolean;
    }> = [];
    const menu = new MainMenu(
      root,
      makeNoopCallbacks({ onSettings: (s) => settingsUpdates.push({ ...s }) }),
      'dune',
    );
    const pause = new PauseOverlay(root, { onResume: () => {}, onReturnToOrbit: () => {} });
    document.body.appendChild(root);

    const dialog = menu.el.querySelector<HTMLDialogElement>('[data-testid="settings-dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(menu.isSettingsOpen()).toBe(false);
    expect(dialog.querySelector('#seed')).toBeNull();
    expect(dialog.querySelector('#s-bloom')).toBeNull();
    expect(dialog.querySelector('#s-skip')).toBeNull();

    // Press Esc -> opens settings popup
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(menu.isSettingsOpen()).toBe(true);

    // Change quality to low, FPS cap to 60, & viewport to 1280x720
    const lowQuality = dialog.querySelector<HTMLInputElement>('input[name="s-quality"][value="low"]')!;
    lowQuality.checked = true;
    lowQuality.dispatchEvent(new Event('change', { bubbles: true }));

    const fps60 = dialog.querySelector<HTMLInputElement>('input[name="s-fps"][value="60"]')!;
    fps60.checked = true;
    fps60.dispatchEvent(new Event('change', { bubbles: true }));

    const res720 = dialog.querySelector<HTMLInputElement>('input[name="s-res"][value="1280x720"]')!;
    res720.checked = true;
    res720.dispatchEvent(new Event('change', { bubbles: true }));

    expect(getFpsCap()).toBe(60);
    expect(settingsUpdates.at(-1)).toMatchObject({
      quality: 'low',
      resolution: '1280x720',
      fpsCap: 60,
      bloom: true,
      skipCinematic: false,
    });

    // In-game PauseOverlay mirrors 60 FPS cap and can switch live to 120 FPS (syncing back to SettingsModal)
    pause.setPaused(true);
    const pause60Btn = pause.el.querySelector<HTMLButtonElement>('[data-fps-cap="60"]')!;
    const pause120Btn = pause.el.querySelector<HTMLButtonElement>('[data-fps-cap="120"]')!;
    expect(pause60Btn.getAttribute('aria-pressed')).toBe('true');
    pause120Btn.click();
    expect(getFpsCap()).toBe(120);
    expect(pause120Btn.getAttribute('aria-pressed')).toBe('true');
    expect(dialog.querySelector<HTMLInputElement>('input[name="s-fps"][value="120"]')?.checked).toBe(true);
    pause.setPaused(false);

    // Press Esc again -> closes settings popup
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(menu.isSettingsOpen()).toBe(false);

    pause.dispose();
    menu.dispose();
    root.remove();
  });
});

describe('Default Pixel-Art & CRT Settings', () => {
  it('defaults pixel-art and CRT effects to ON unless explicitly disabled via query or saved storage', () => {
    expect(resolveInitialPixelArt(null, null)).toBe(true);
    expect(resolveInitialPixelArt('0', null)).toBe(false);
    expect(resolveInitialPixelArt(null, '0')).toBe(false);
    expect(resolveInitialPixelArt('1', '0')).toBe(true);

    expect(resolveInitialCrt(null, null)).toBe(true);
    expect(resolveInitialCrt('0', null)).toBe(false);
    expect(resolveInitialCrt(null, '0')).toBe(false);
    expect(resolveInitialCrt('1', '0')).toBe(true);
  });
});

describe('Cross-UI MAX FPS & Shadow Quality Synchronization', () => {
  afterEach(() => {
    setFpsCap(0);
    setShadowQuality('auto');
    localStorage.clear();
  });

  it('keeps MainMenu, SettingsModal, and PauseOverlay synchronized on SHADOWS quality changes', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const updated: MenuSettings[] = [];
    const menu = new MainMenu(root, makeNoopCallbacks({ onSettings: (s) => updated.push({ ...s }) }), 'dune');
    const pause = new PauseOverlay(root, { onResume: () => {}, onReturnToOrbit: () => {} });
    const dialog = menu.el.querySelector<HTMLDialogElement>('[data-testid="settings-dialog"]')!;

    const medRadio = dialog.querySelector<HTMLInputElement>('input[name="s-shadows"][value="med"]')!;
    medRadio.checked = true;
    medRadio.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getShadowQuality()).toBe('med');
    expect(updated.at(-1)?.shadows).toBe('med');

    pause.setPaused(true);
    const pauseMedBtn = pause.el.querySelector<HTMLButtonElement>('[data-shadow-quality="med"]')!;
    expect(pauseMedBtn.getAttribute('aria-pressed')).toBe('true');

    const pauseLowBtn = pause.el.querySelector<HTMLButtonElement>('[data-shadow-quality="low"]')!;
    pauseLowBtn.click();
    expect(getShadowQuality()).toBe('low');
    expect(menu.settings.shadows).toBe('low');
    expect(dialog.querySelector<HTMLInputElement>('input[name="s-shadows"][value="low"]')?.checked).toBe(true);

    pause.dispose();
    menu.dispose();
    root.remove();
  });

  it('keeps MainMenu.settings.fpsCap synchronized when MAX FPS changes via PauseOverlay, GameHud, or F8 PERF so Deploy/Settings never wipe it out', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const deployed: MenuSettings[] = [];
    const updated: MenuSettings[] = [];

    const menu = new MainMenu(
      root,
      makeNoopCallbacks({
        onDeploy: (_k, _seed, st) => { deployed.push({ ...st }); },
        onSettings: (st) => { updated.push({ ...st }); },
      }),
      'dune',
    );
    const pause = new PauseOverlay(root, { onResume: () => {}, onReturnToOrbit: () => {} });
    const gHud = new GameHud(root, 'Dune', 1, { onResume: () => {}, onReturn: () => {} });

    expect(menu.settings.fpsCap).toBe(0);

    // 1. Change FPS cap via PauseOverlay without opening SettingsModal -> MainMenu.settings.fpsCap & Deploy stay at 30
    pause.el.querySelector<HTMLButtonElement>('[data-fps-cap="30"]')!.click();
    expect(getFpsCap()).toBe(30);
    expect(menu.settings.fpsCap).toBe(30);
    menu.el.querySelector<HTMLButtonElement>('#deploy')!.click();
    expect(deployed.at(-1)?.fpsCap).toBe(30);

    // 2. Change FPS cap via GameHud -> MainMenu.settings.fpsCap updates to 90
    gHud.pause.querySelector<HTMLButtonElement>('[data-fps-cap="90"]')!.click();
    expect(getFpsCap()).toBe(90);
    expect(menu.settings.fpsCap).toBe(90);

    // 3. Change FPS cap via F8 -> PERF (`setFpsCap(60)`), then change Quality in SettingsModal -> 60 FPS is preserved
    setFpsCap(60);
    expect(menu.settings.fpsCap).toBe(60);
    const dialog = menu.el.querySelector<HTMLDialogElement>('[data-testid="settings-dialog"]')!;
    const lowQuality = dialog.querySelector<HTMLInputElement>('input[name="s-quality"][value="low"]')!;
    lowQuality.checked = true;
    lowQuality.dispatchEvent(new Event('change', { bubbles: true }));
    expect(getFpsCap()).toBe(60);
    expect(updated.at(-1)?.fpsCap).toBe(60);
    expect(menu.settings.fpsCap).toBe(60);

    // 4. Changing Shader Optimizations & Viewport Preset via perfConfig (F8) keeps MainMenu.settings & SettingsModal synced
    menu.show();
    setShaderOptimized(false);
    setViewportPreset('1920x1080');
    expect(menu.settings.optimized).toBe(false);
    expect(menu.settings.resolution).toBe('1920x1080');
    menu.el.querySelector<HTMLButtonElement>('#deploy')!.click();
    expect(deployed.at(-1)).toMatchObject({ optimized: false, resolution: '1920x1080', fpsCap: 60 });
    setShaderOptimized(true);
    setViewportPreset('auto');

    gHud.dispose();
    pause.dispose();
    menu.dispose();
    root.remove();
  });
});
