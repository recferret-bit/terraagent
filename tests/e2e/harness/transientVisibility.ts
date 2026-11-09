import { expect, type Page } from '@playwright/test';

interface VisibilityProbe { seen: boolean; finished: boolean; stop(): void }
interface ProbeWindow extends Window { __visibilityProbe?: VisibilityProbe }
interface ExpectedElement { text?: string; role?: string }

/** Record a real visible DOM state even when a fast response removes it between Playwright polls. */
export async function observeTransientVisibility(page: Page, selector: string, timeout: number, expected: ExpectedElement = {}) {
  await page.evaluate(({ selector, timeout, expected }) => {
    const w = window as ProbeWindow;
    w.__visibilityProbe?.stop();
    const deadline = performance.now() + timeout;
    const state: VisibilityProbe = { seen: false, finished: false, stop: () => {} };
    const check = (element: Element | null, parent?: Node) => {
      if (!element || performance.now() > deadline) return;
      if (expected.text && element.textContent !== expected.text) return;
      if (expected.role && element.getAttribute('role') !== expected.role) return;
      // A removed chip has no layout box: its still-connected mutation parent supplies the visibility context.
      const visible = element.isConnected ? element : parent instanceof Element ? parent : null;
      if (!visible?.isConnected || !visible.getClientRects().length || getComputedStyle(visible).visibility === 'hidden') return;
      if (getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden') return;
      state.seen = true;
      state.stop();
    };
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        check(node.matches(selector) ? node : node.querySelector(selector), record.target);
      }
      check(document.querySelector(selector));
    });
    const timer = setTimeout(() => state.stop(), timeout);
    state.stop = () => { state.finished = true; observer.disconnect(); clearTimeout(timer); };
    w.__visibilityProbe = state;
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    check(document.querySelector(selector));
  }, { selector, timeout, expected });
  return {
    async assertSeen() {
      await page.waitForFunction(() => (window as ProbeWindow).__visibilityProbe?.finished, undefined, { timeout });
      expect(await page.evaluate(() => (window as ProbeWindow).__visibilityProbe?.seen), `${selector} was visible within ${timeout}ms`).toBe(true);
    },
    async dispose() {
      await page.evaluate(() => { const w = window as ProbeWindow; w.__visibilityProbe?.stop(); delete w.__visibilityProbe; });
    },
  };
}
