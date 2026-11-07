// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { bindDock, isDockHidden, setDockHidden, setDockSuppressed } from './dock';

function mount(): void {
  document.body.innerHTML = `<div id="pg"><aside id="side"></aside><main id="stage"><div id="overlay">
    <section id="info"></section><section id="bar"></section><section id="lights-panel"></section>
  </div></main></div>`;
}

describe('playground docks', () => {
  beforeEach(mount);

  it('toggles a panel from its header tab and marks the open state', () => {
    const panel = document.querySelector<HTMLElement>('#side')!;
    bindDock({
      id: 'side', panel, edge: 'left', showLabel: 'LIST', showTitle: 'Hide or show the object list',
      mount: document.querySelector<HTMLElement>('#stage')!,
    });

    const show = document.querySelector<HTMLButtonElement>('[data-testid="dock-show-side"]')!;
    expect(show.hidden).toBe(false);
    expect(show.classList.contains('on')).toBe(true);
    expect(show.textContent).toBe('LIST');
    expect(show.parentElement?.id).toBe('pg-show-bar');
    expect(show.parentElement?.getAttribute('role')).toBe('tablist');
    expect(show.parentElement?.parentElement?.id).toBe('overlay');

    show.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isDockHidden('side')).toBe(true);
    expect(panel.classList.contains('is-dock-hidden')).toBe(true);
    expect(show.classList.contains('on')).toBe(false);
    expect(show.getAttribute('aria-selected')).toBe('false');

    show.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isDockHidden('side')).toBe(false);
    expect(panel.classList.contains('is-dock-hidden')).toBe(false);
    expect(show.hidden).toBe(false);
    expect(show.classList.contains('on')).toBe(true);
    expect(show.getAttribute('aria-selected')).toBe('true');
  });

  it('suppresses the header tab while a feature-gated panel is off, and opens it on the next enable', () => {
    const panel = document.querySelector<HTMLElement>('#lights-panel')!;
    bindDock({ id: 'lights', panel, edge: 'right', showLabel: 'LIGHTS', showTitle: 'Hide or show the lights editor' });

    document.querySelector<HTMLButtonElement>('[data-testid="dock-show-lights"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setDockSuppressed('lights', true);
    const show = document.querySelector<HTMLButtonElement>('[data-testid="dock-show-lights"]')!;
    expect(show.hidden).toBe(true);
    expect(panel.classList.contains('is-dock-hidden')).toBe(true);

    setDockSuppressed('lights', false);
    expect(show.hidden).toBe(false);
    setDockHidden('lights', false);
    expect(panel.classList.contains('is-dock-hidden')).toBe(false);
    expect(show.hidden).toBe(false);
    expect(show.classList.contains('on')).toBe(true);
  });
});
