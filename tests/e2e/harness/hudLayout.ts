import { expect, type Page } from '@playwright/test';

/**
 * HUD tab books (`frontend/game/core/hud/TabBook.ts`): the Command Dock (right, `command-dock`, tabs `dock-tab-<id>`)
 * and the Colony book (left, `colony-book`, tabs `colony-tab-<id>`). A panel in a book is hidden until its tab is the
 * active tab of an unfolded book, so a spec opens the tab before it reads or clicks the panel.
 */
async function openBookTab(page: Page, bookTestId: string, tabTestId: string, id: string): Promise<void> {
  const book = page.getByTestId(bookTestId);
  const tab = page.getByTestId(tabTestId);
  await expect(tab, `${tabTestId} missing: its feature is off or the panel is not routed to the ${bookTestId}`).toHaveCount(1);
  const open = async () => (await book.getAttribute('data-collapsed')) !== 'true' && (await book.getAttribute('data-active-tab')) === id;
  if (!(await open())) await tab.click();
  await expect.poll(open).toBe(true);
}

/** Opens the Colony book (left) on tab `id` (`deed`, `goals`, `hq`, `director`, `combat`, `supply`, `trade`). */
export const openColonyTab = (page: Page, id: string): Promise<void> => openBookTab(page, 'colony-book', `colony-tab-${id}`, id);

/** Opens the Command Dock (right) on tab `id` (`build`, `production`, `terraform`, `queue`). */
export const openDockTab = (page: Page, id: string): Promise<void> => openBookTab(page, 'command-dock', `dock-tab-${id}`, id);

export interface HudLayoutReport {
  /** Overlapping pairs, `<a> off-screen`, and `minimap not in the top-left corner`; empty when the layout is clean. */
  issues: string[];
  /** Which named boxes were on screen (`rightBook`, `leftBook`, `pilot`, `minimap`, `selectionBar`, `topCenter`, `bottomLeft`, `bottomRight`). */
  present: string[];
}

/**
 * Checks the HUD layout of the tab-book HUD: the right book (top right) against the top-center bar, the left book
 * (top left) against the minimap above it, the two books against each other, an open page on top of every other HUD
 * plate (it may cover the bottom stacks) and inside the screen, the minimap inside the top-left corner, and nothing off-screen. Boxes are per visible element (each
 * child of a slot), so two plates that merely share a slot do not count.
 */
export function hudLayout(page: Page): Promise<HudLayoutReport> {
  return page.evaluate(() => {
    type Box = { name: string; r: DOMRect };
    const box = (name: string, el: Element | null): Box | null => {
      if (!el || (el as HTMLElement).hidden) return null;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 ? { name, r } : null;
    };
    const kids = (slot: string): Box[] =>
      Array.from(document.querySelectorAll(`.ta-hud__slot[data-slot='${slot}'] > *`), (el) =>
        box(`${slot}:${(el as HTMLElement).dataset.panel ?? el.className}`, el)).filter((b): b is Box => b !== null);
    const rightBook = box('rightBook', document.querySelector('[data-testid=command-dock]'));
    const leftBook = box('leftBook', document.querySelector('[data-testid=colony-book]'));
    const pilot = box('pilot', document.querySelector("[data-panel='pilot']"));
    const minimap = box('minimap', document.querySelector('[data-testid=minimap-hud]'));
    // Bottom-centre selection bar (landfall `.ta-hq-panel`, fixed inside a 0×0 bottom-left panel wrapper).
    const selectionBar = box('selectionBar', document.querySelector('.ta-hq-panel'));
    const topCenter = kids('top-center');
    const bottomLeft = kids('bottom-left');
    const bottomRight = kids('bottom-right');
    const topLeftPlates = kids('top-left').filter((b) => !b.name.includes('ta-book'));
    const hit = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const issues: string[] = [];
    const check = (a: Box | null, others: readonly (Box | null)[]) => {
      if (!a) return;
      for (const o of others) {
        if (!o || !hit(a.r, o.r)) continue;
        const dx = Math.round(Math.min(a.r.right, o.r.right) - Math.max(a.r.left, o.r.left));
        const dy = Math.round(Math.min(a.r.bottom, o.r.bottom) - Math.max(a.r.top, o.r.top));
        issues.push(`${a.name} x ${o.name} (${dx}x${dy} px)`);
      }
    };
    // An open book may cover the bottom stacks (owner, 2026-11-10: the page grows to the screen bottom, above all HUD).
    // Both rightBook (command-dock) and leftBook (colony-book) are combined in the top-right slot; only one page opens at a time.
    check(rightBook, [...topCenter]);
    check(leftBook, [minimap, ...topLeftPlates.filter((b) => b.name !== 'top-left:minimap'), ...topCenter]);
    for (const page of Array.from(document.querySelectorAll<HTMLElement>('.ta-book:not([data-collapsed="true"]) .ta-book__page'))) {
      const r = page.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const hitEl = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 40));
      const name = page.closest('[data-testid]')?.getAttribute('data-testid');
      // Modals in the overlay layer (stage notice, deed) are meant to sit above the books.
      if (hitEl && !page.contains(hitEl) && hitEl.closest('.ta-hud') && !hitEl.closest('.ta-hud__overlay')) issues.push(`${name} page covered by ${hitEl.className}`);
      if (r.bottom > innerHeight + 1) issues.push(`${name} page runs off the bottom (${Math.round(r.bottom)} > ${innerHeight})`);
    }
    check(minimap, [...bottomRight, ...topCenter, ...bottomLeft]);
    check(selectionBar, [...bottomLeft.filter((b) => b.name !== 'bottom-left:hq-panel'), ...bottomRight, minimap]);
    // Every tab column fits its book from 600 px height up (phone landscape scrolls the left column by design, FF-98).
    for (const spine of innerHeight >= 600 ? Array.from(document.querySelectorAll('.ta-book__spine')) : []) {
      if (spine.scrollHeight > spine.clientHeight + 1) {
        issues.push(`${spine.closest('[data-testid]')?.getAttribute('data-testid')} tab column scrolls (${spine.scrollHeight} > ${spine.clientHeight} px)`);
      }
    }
    for (const b of [rightBook, leftBook, pilot, minimap, ...topCenter, ...bottomLeft, ...bottomRight]) {
      if (b && (b.r.top < -1 || b.r.left < -1 || b.r.bottom > innerHeight + 1 || b.r.right > innerWidth + 1)) {
        issues.push(`${b.name} off-screen`);
      }
    }
    // The minimap sits in the top-left corner: flush left, at the top (≤ 1000 px wide it starts under the resource bar).
    if (minimap && (minimap.r.left > 40 || minimap.r.top > (innerWidth <= 1000 ? 72 : 40))) {
      issues.push(`minimap not in the top-left corner (${Math.round(minimap.r.left)},${Math.round(minimap.r.top)})`);
    }
    const present = Object.entries({ rightBook, leftBook, pilot, minimap, selectionBar })
      .filter(([, b]) => b !== null).map(([n]) => n);
    if (topCenter.length) present.push('topCenter');
    if (bottomLeft.length) present.push('bottomLeft');
    if (bottomRight.length) present.push('bottomRight');
    return { issues, present };
  });
}

/** Asserts a clean layout and that every name in `required` was on screen (so the check is not vacuous). */
export async function expectCleanHudLayout(page: Page, required: readonly string[], label = ''): Promise<void> {
  const size = page.viewportSize();
  const message = `HUD layout ${size ? `${size.width}x${size.height}` : ''} ${label}`.trim();
  await expect.poll(async () => {
    const { issues, present } = await hudLayout(page);
    return [...issues, ...required.filter((n) => !present.includes(n)).map((n) => `${n} missing`)];
  }, { timeout: 10_000, message }).toEqual([]);
}
