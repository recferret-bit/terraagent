// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ColonyBook, resolveColonyTab, type ColonyTabId } from './ColonyBook';

afterEach(() => document.body.replaceChildren());

function makeColony(tabs: readonly ColonyTabId[]): ColonyBook {
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  return new ColonyBook(slot, new Set(tabs));
}

describe('resolveColonyTab routing', () => {
  it.each([
    ['identity', 'pilot', 'player'],
    ['achievements', 'pilot-tracking', 'player'],
    ['deed', 'colony-deed', 'deed'],
    ['stages', 'stage-track-hud', 'goals'],
    ['goals', 'goals-panel', 'hq'],
    ['director', 'director-status', 'director'],
    ['combat', 'combat-alerts', 'combat'],
    ['combat-tuning', 'combat-tuning', 'combat'],
    ['market', 'supply-trade', 'supply'],
    ['trade-hub', 'trade-hub-panel', 'trade'],
    ['market', 'contracts', 'trade'],
    ['market', 'market-tab', 'trade'],
  ] as const)('%s/%s → %s', (feature, panel, tab) => {
    expect(resolveColonyTab(feature, panel)).toBe(tab);
  });

  it('unknown features or panels keep their slot (null)', () => {
    expect(resolveColonyTab('maps', 'minimap')).toBeNull();
    expect(resolveColonyTab('deed', 'other-panel')).toBeNull(); // a feature's other panels stay in their slot
    expect(resolveColonyTab('colony-deed', 'deed')).toBeNull(); // order matters: feature first
    expect(resolveColonyTab('', '')).toBeNull();
    expect(resolveColonyTab('deed/colony-deed', '')).toBeNull();
  });
});

describe('ColonyBook (left tab book)', () => {
  it('is a left book with its test ids and the tabs in fixed order, whatever the set order', () => {
    const colony = makeColony(['trade', 'deed', 'hq', 'goals']);
    expect(colony.el.getAttribute('data-testid')).toBe('colony-book');
    expect(colony.el.dataset.side).toBe('left');
    expect(colony.el.classList.contains('ta-colony-book')).toBe(true);
    const ids = [...colony.el.querySelectorAll('.ta-book__tab')].map((t) => t.getAttribute('data-testid'));
    expect(ids).toEqual(['colony-tab-deed', 'colony-tab-goals', 'colony-tab-hq', 'colony-tab-trade']);
    expect(document.querySelector('[data-testid=colony-book-toggle]')).not.toBeNull();
    expect(colony.book.getActiveTab()).toBe('deed');
    expect(document.querySelector('[data-testid=colony-tab-hq]')!.textContent).toBe('HQ AI');
  });

  it('PLAYER is the first tab and opens first when present', () => {
    const colony = makeColony(['trade', 'deed', 'player']);
    expect(colony.book.getActiveTab()).toBe('player');
    expect([...colony.el.querySelectorAll('[data-testid^=colony-tab-]')].map((b) => b.getAttribute('data-testid')))
      .toEqual(['colony-tab-player', 'colony-tab-deed', 'colony-tab-trade']);
    expect(document.querySelector('[data-testid=colony-tab-player]')!.textContent).toBe('PLAYER');
  });

  it('only the available tabs exist; containerFor an absent tab falls back to the page', () => {
    const colony = makeColony(['combat']);
    expect(colony.book.has('combat')).toBe(true);
    expect(colony.book.has('deed')).toBe(false);
    expect(colony.containerFor('combat').getAttribute('data-tab-pane')).toBe('combat');
    expect(colony.containerFor('deed')).toBe(colony.book.pageEl);
  });

  it('dispose removes the book', () => {
    const colony = makeColony(['deed']);
    colony.dispose();
    expect(document.querySelector('[data-testid=colony-book]')).toBeNull();
  });
});
