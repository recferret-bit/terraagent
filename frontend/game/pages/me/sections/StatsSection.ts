import type { ProfileStats } from '@terra/contracts';
import { el } from '../dom';

/** Renders the 16 Stats tiles inside `#progress` (implemented in W12-16). */
export function renderStatsSection(_stats: ProfileStats): HTMLElement {
  return el('div', { className: 'ta-stats-grid', dataset: { testid: 'me-stats-grid' } });
}
