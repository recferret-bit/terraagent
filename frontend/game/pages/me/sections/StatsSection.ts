import { PROFILE_STAT_DEFINITIONS, type ProfileStats } from '@terra/contracts';
import { el, formatThinInt } from '../dom';
import './stats.css';

/**
 * Renders the 16 lifetime stats tiles inside `#progress` (W12-16):
 * `repeat(auto-fit, minmax(130px, 1fr))` grid with numbers formatted with spaces (`12 450`).
 */
export function renderStatsSection(stats: ProfileStats): HTMLElement {
  const tiles = PROFILE_STAT_DEFINITIONS.map((def) => {
    const rawValue = stats[def.key] ?? 0;
    const formatted =
      def.key === 'highestStageReached'
        ? `S${rawValue}`
        : def.unit
          ? `${formatThinInt(rawValue)} ${def.unit}`
          : formatThinInt(rawValue);

    return el(
      'div',
      {
        className: 'plate-sm ta-stat-tile',
        dataset: { testid: `me-stat-${def.key}`, statKey: def.key },
      },
      el('span', { className: 'label ta-stat-label' }, def.label),
      el('strong', { className: 'ta-stat-value' }, formatted),
    );
  });

  return el(
    'div',
    { className: 'ta-stats-block', dataset: { testid: 'me-stats-block' } },
    el('h3', { className: 'label ta-sub-eyebrow' }, 'CAREER TELEMETRY · 16 METRICS'),
    el('div', { className: 'ta-stats-grid', dataset: { testid: 'me-stats-grid' } }, ...tiles),
  );
}
