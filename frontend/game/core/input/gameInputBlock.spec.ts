// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { PauseOverlay } from '../../app/online/PauseOverlay';
import { isHotkeyPress } from '../../features/shared/hotkeys';
import { mountTerraformBasic } from '../../features/terraform-basic';
import { GlobalMapOpenCloseController } from '../../maps/openCloseController';
import { CommandDock } from '../hud/CommandDock';
import { gameInputBlockers, isGameInputBlocked, resetGameInputBlock, setGameInputBlocked } from './gameInputBlock';

const press = (key: string, target: EventTarget = window) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
};

afterEach(() => {
  resetGameInputBlock();
  document.body.replaceChildren();
});

describe('shared modal input block (core/input/gameInputBlock)', () => {
  it('tracks independent sources; `except` asks whether another modal is up', () => {
    expect(isGameInputBlocked()).toBe(false);
    setGameInputBlocked('global-map', true);
    setGameInputBlocked('global-map', true);
    expect(gameInputBlockers()).toEqual(['global-map']);
    expect(isGameInputBlocked()).toBe(true);
    expect(isGameInputBlocked('global-map')).toBe(false);
    setGameInputBlocked('pause', true);
    expect(isGameInputBlocked('global-map')).toBe(true);
    setGameInputBlocked('global-map', false);
    setGameInputBlocked('pause', false);
    expect(isGameInputBlocked()).toBe(false);
  });

  it('isHotkeyPress is false while a modal blocks, true again after', () => {
    const e = new KeyboardEvent('keydown', { key: 'r' });
    expect(isHotkeyPress(e)).toBe(true);
    setGameInputBlocked('global-map', true);
    expect(isHotkeyPress(e)).toBe(false);
    setGameInputBlocked('global-map', false);
    expect(isHotkeyPress(e)).toBe(true);
  });
});

describe('hotkeys stay quiet under the open global map', () => {
  it('B / U / T do not toggle the Command Dock and G does not arm the brush while the map is open', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const dock = new CommandDock(slot, {} as never, new Set(['build', 'production', 'terraform'] as const));
    const tf = mountTerraformBasic(dock.containerFor('terraform'), {});
    dock.selectTab('terraform');
    const map = new GlobalMapOpenCloseController();

    press('m');
    expect(map.isOpen).toBe(true);
    expect(isGameInputBlocked()).toBe(true);
    for (const key of ['b', 'u', 't']) press(key);
    expect([dock.getActiveTab(), dock.isCollapsed()]).toEqual(['terraform', false]);
    press('g');
    expect(tf.isArmed()).toBe(false);

    press('Escape');
    expect(map.isOpen).toBe(false);
    expect(isGameInputBlocked()).toBe(false);
    press('g');
    expect(tf.isArmed()).toBe(true);
    press('b');
    expect(dock.getActiveTab()).toBe('build');

    map.dispose();
    tf.dispose();
    dock.dispose();
  });

  it('typing in a text field (dev console) still works under the map; Esc there does not close the map', () => {
    const map = new GlobalMapOpenCloseController();
    map.open();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const typed = press('w', input);
    expect(typed.defaultPrevented).toBe(false); // the map does not eat the key; it reaches the input
    press('Escape', input);
    expect(map.isOpen).toBe(true);
    press('Escape');
    expect(map.isOpen).toBe(false);
    map.dispose();
  });

  it('dispose of an open map lifts its block', () => {
    const map = new GlobalMapOpenCloseController();
    map.open();
    expect(gameInputBlockers()).toEqual(['global-map']);
    map.dispose();
    expect(isGameInputBlocked()).toBe(false);
  });
});

describe('pause dialog feeds the same block', () => {
  it('while paused, game hotkeys are quiet and M does not open the map', () => {
    const pause = new PauseOverlay(document.body, { onResume() {}, onReturnToOrbit() {} });
    const map = new GlobalMapOpenCloseController();
    pause.setPaused(true);
    expect(isGameInputBlocked()).toBe(true);
    expect(isHotkeyPress(new KeyboardEvent('keydown', { key: 'x' }))).toBe(false);
    press('m');
    map.open();
    expect(map.isOpen).toBe(false);
    pause.setPaused(false);
    press('m');
    expect(map.isOpen).toBe(true);
    map.dispose();
    pause.dispose();
  });
});
