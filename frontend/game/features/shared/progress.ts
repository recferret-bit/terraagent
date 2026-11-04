import { clampPct, makeDiv } from './dom';

/** Shared progress meter; the fill remains exposed for existing status-panel callers. */
export function createProgressBar(label: string, barClass: string, fillClass: string, testId: string) {
  const bar = makeDiv(barClass);
  const fill = makeDiv(fillClass, testId);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', label);
  bar.appendChild(fill);
  setProgress(fill, 0, 1);
  return { bar, fill };
}

export function setProgress(fill: HTMLElement, value: number, max: number): void {
  const pct = clampPct(value, max);
  fill.style.width = `${pct.toFixed(1)}%`;
  fill.setAttribute('data-progress', String(Math.round(pct)));
  const bar = fill.parentElement;
  bar?.setAttribute('aria-valuemin', '0');
  bar?.setAttribute('aria-valuemax', String(max));
  bar?.setAttribute('aria-valuenow', String(Math.min(max, Math.max(0, value))));
}

/** Native range input: keyboard/pointer events share one callback and one fill calculation. */
export function setRangeProgress(input: HTMLInputElement, value: number, max: number): void {
  input.style.setProperty('--val', `${clampPct(value, max).toFixed(1)}%`);
}
