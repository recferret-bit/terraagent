// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindCardTip, hideActiveCardTip } from './menuCards';
import { BUILD_GROUPS, layoutMenuGroups } from './menuSections';

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('card description popups and menu layout stability', () => {
  afterEach(() => {
    hideActiveCardTip();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows at most one tooltip, places it strictly to the left of the expanded menu, and dismisses reliably including on disabled cards', () => {
    const dock = document.createElement('div');
    dock.setAttribute('data-testid', 'command-dock');
    const book = document.createElement('div');
    book.className = 'ta-book';
    const page = document.createElement('div');
    page.className = 'ta-book__page';
    page.getBoundingClientRect = () => rectOf(920, 64, 348, 520);

    const cardA = document.createElement('button');
    cardA.type = 'button';
    cardA.className = 'ta-construction__card';
    cardA.getBoundingClientRect = () => rectOf(940, 140, 100, 108);
    const tipA = document.createElement('span');
    tipA.className = 'ta-card-tip';
    tipA.getBoundingClientRect = () => rectOf(0, 0, 220, 110);
    cardA.appendChild(tipA);
    bindCardTip(cardA, tipA);

    const cardB = document.createElement('button');
    cardB.type = 'button';
    cardB.disabled = true;
    cardB.className = 'ta-construction__card';
    cardB.getBoundingClientRect = () => rectOf(1050, 280, 100, 108);
    const tipB = document.createElement('span');
    tipB.className = 'ta-card-tip';
    tipB.getBoundingClientRect = () => rectOf(0, 0, 220, 140);
    cardB.appendChild(tipB);
    bindCardTip(cardB, tipB);

    page.append(cardA, cardB);
    book.appendChild(page);
    dock.appendChild(book);
    document.body.appendChild(dock);

    // Hover card A -> tipA appears immediately to the left of `.ta-book__page` (920 - 220 - 8 = 692, top = 64)
    cardA.dispatchEvent(new Event('pointerenter'));
    expect(tipA.parentElement).toBe(document.body);
    expect(tipA.style.display).toBe('flex');
    expect(tipA.style.left).toBe('692px');
    expect(tipA.style.top).toBe('64px');

    // Hover disabled card B -> tipA closes and tipB opens in the exact same spot
    cardB.dispatchEvent(new Event('pointerenter'));
    expect(tipA.style.display).toBe('');
    expect(tipA.parentElement).toBe(cardA);
    expect(tipB.parentElement).toBe(document.body);
    expect(tipB.style.display).toBe('flex');
    expect(tipB.style.left).toBe('692px');
    expect(tipB.style.top).toBe('64px');

    // Moving pointer outside cardB closes tipB even when cardB is disabled and pointerleave didn't fire
    const moveOut = new Event('pointermove') as PointerEvent;
    Object.defineProperties(moveOut, { clientX: { value: 600 }, clientY: { value: 200 } });
    window.dispatchEvent(moveOut);
    expect(tipB.style.display).toBe('');
    expect(tipB.parentElement).toBe(cardB);

    // Focus right after pointerdown does not re-open a dismissed tip; Escape/hideActiveCardTip closes focus tips
    cardA.dispatchEvent(new Event('pointerdown'));
    cardA.dispatchEvent(new Event('focus'));
    expect(tipA.style.display).toBe('');

    cardB.dispatchEvent(new Event('pointerenter'));
    expect(tipB.style.display).toBe('flex');
    window.dispatchEvent(new Event('blur'));
    expect(tipB.style.display).toBe('');
  });

  it('layoutMenuGroups skips DOM detachment when card membership and order have not changed', () => {
    const container = document.createElement('div');
    const heads = new Map<string, HTMLElement>();
    const hub = document.createElement('button');
    const mine = document.createElement('button');
    const cards = [
      { key: 'commandHub', el: hub },
      { key: 'metalsExtractor', el: mine },
    ];

    layoutMenuGroups(container, BUILD_GROUPS, cards, heads);
    const removeSpy = vi.spyOn(hub, 'remove');
    const appendSpy = vi.spyOn(container, 'appendChild');
    const replaceSpy = vi.spyOn(container, 'replaceChildren');

    layoutMenuGroups(container, BUILD_GROUPS, cards, heads);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
