// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MainMenu, type MenuCallbacks } from './menu';

function makeNoopCallbacks(overrides: Partial<MenuCallbacks> = {}): MenuCallbacks {
  return {
    onPlanet: () => {},
    onDeploy: () => {},
    onSettings: () => {},
    ...overrides,
  };
}

describe('Settings Modal (Esc key)', () => {
  it('toggles Quality, Shader Optimizations, and Viewport settings on Escape without bloom/skip/seed', () => {
    const root = document.createElement('div');
    const settingsUpdates: Array<{
      quality: string;
      optimized: boolean;
      resolution: string;
      bloom: boolean;
      skipCinematic: boolean;
    }> = [];
    const menu = new MainMenu(
      root,
      makeNoopCallbacks({ onSettings: (s) => settingsUpdates.push({ ...s }) }),
      'dune',
    );
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

    // Change quality to low & viewport to 1280x720
    const lowQuality = dialog.querySelector<HTMLInputElement>('input[name="s-quality"][value="low"]')!;
    lowQuality.checked = true;
    lowQuality.dispatchEvent(new Event('change', { bubbles: true }));

    const res720 = dialog.querySelector<HTMLInputElement>('input[name="s-res"][value="1280x720"]')!;
    res720.checked = true;
    res720.dispatchEvent(new Event('change', { bubbles: true }));

    expect(settingsUpdates.at(-1)).toMatchObject({
      quality: 'low',
      resolution: '1280x720',
      bloom: true,
      skipCinematic: false,
    });

    // Press Esc again -> closes settings popup
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(menu.isSettingsOpen()).toBe(false);

    menu.dispose();
    root.remove();
  });
});
