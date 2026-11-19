// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MainMenu, type MenuCallbacks } from './menu';

function menu(): MainMenu {
  const cb: MenuCallbacks = { onPlanet: () => {}, onDeploy: () => {}, onSettings: () => {} };
  const root = document.createElement('div');
  document.body.appendChild(root);
  return new MainMenu(root, cb, 'dune');
}

function targetSector(ui: MainMenu): string | undefined {
  return ui.getGlobeMarkers().find((m) => m.role === 'target')?.id;
}

function pointer(type: string, related?: EventTarget): Event {
  const ev = new Event(type);
  Object.defineProperty(ev, 'relatedTarget', { value: related ?? null });
  return ev;
}

describe('Orbit picker chrome', () => {
  const open: MainMenu[] = [];
  afterEach(() => {
    for (const ui of open) ui.dispose();
    open.length = 0;
    document.body.replaceChildren();
  });

  it('keeps Escape, drops the settings and landing buttons, and stacks the pilot in the top-right', () => {
    const ui = menu();
    open.push(ui);
    expect(ui.el.querySelector('[data-testid="settings-trigger"]')).toBeNull();
    expect(ui.el.querySelector('a[href="/landing.html"]')).toBeNull();
    expect(ui.el.textContent).not.toContain('TERRAAGENT.FUN');
    const actions = ui.el.querySelector('.menu-top-actions');
    expect(actions?.querySelector('[data-testid="pilot-access"]')).not.toBeNull();

    expect(ui.isSettingsOpen()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(ui.isSettingsOpen()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(ui.isSettingsOpen()).toBe(false);
  });

  it('lets the orange sector card keep the pointer when it is the active card', () => {
    const ui = menu();
    open.push(ui);
    const launch = ui.el.querySelector<HTMLElement>('[data-testid="ar-card-launch"]')!;
    const presence = ui.el.querySelector<HTMLElement>('[data-testid="ar-card-presence"]')!;
    const launchWrap = ui.el.querySelector<HTMLElement>('.ar-wrap-launch')!;

    launch.dispatchEvent(pointer('pointerenter'));
    expect(presence.style.pointerEvents).toBe('none');
    expect(launchWrap.style.zIndex).toBe('4');

    launch.dispatchEvent(pointer('pointerleave', document.body));
    expect(presence.style.pointerEvents).toBe('');
    expect(launchWrap.style.zIndex).toBe('2');
  });

  it('does not flip the hovered sector when the pointer moves between sector buttons or the list rebuilds', () => {
    const ui = menu();
    open.push(ui);
    const first = ui.el.querySelector<HTMLElement>('.sector-opt-land')!;
    const second = ui.el.querySelectorAll<HTMLElement>('.sector-opt-land')[1]!;
    const firstId = first.dataset.sectorId!;

    first.dispatchEvent(pointer('pointerenter'));
    expect(targetSector(ui)).toBe(firstId);

    first.dispatchEvent(pointer('pointerleave', second));
    expect(targetSector(ui)).toBe(firstId);

    second.dispatchEvent(pointer('pointerenter'));
    expect(targetSector(ui)).toBe(second.dataset.sectorId);

    const current = ui.el.querySelector<HTMLElement>(`[data-testid="sector-opt-${second.dataset.sectorId}"]`)!;
    current.click();
    expect(ui.getSectorIntent()).toEqual({ mode: 'chosen', sectorId: second.dataset.sectorId });
    current.remove();
    current.dispatchEvent(pointer('pointerleave'));
    expect(targetSector(ui)).toBe(second.dataset.sectorId);
    expect(ui.getSectorIntent()).toEqual({ mode: 'chosen', sectorId: second.dataset.sectorId });
  });
});
