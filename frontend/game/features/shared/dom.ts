/** Small DOM builders shared by the feature panels (browser DOM; specs run them under jsdom). */

/** Sets `data-<key>` (kebab-case key) on `el`. */
export function setDataAttr(el: HTMLElement, key: string, val: string): void {
  el.setAttribute(`data-${key}`, val);
}

export function makeDiv(cls: string, testid?: string, text?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  if (testid) setDataAttr(el, 'testid', testid);
  if (text !== undefined) el.textContent = text;
  return el;
}

export function makeBtn(cls: string, testid: string, text: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  setDataAttr(btn, 'testid', testid);
  btn.textContent = text;
  btn.onclick = onClick;
  return btn;
}

export function makeSpan(cls: string, testid?: string, text?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  if (testid) setDataAttr(el, 'testid', testid);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Percentage of `value` in `0..max`, clamped to `0..100` (0 when `max` is not positive). */
export function clampPct(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
