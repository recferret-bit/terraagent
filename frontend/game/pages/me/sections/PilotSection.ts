import type { MeProfileResponse } from '@terra/contracts';
import { el, formatThinInt } from '../dom';
import './pilot.css';

function formatPilotSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function xpPercent(xp: number, currentLevelXp: number, nextLevelXp: number): number {
  if (nextLevelXp <= currentLevelXp) return 100;
  const span = nextLevelXp - currentLevelXp;
  const into = Math.max(0, xp - currentLevelXp);
  return Math.max(0, Math.min(100, Math.round((into / span) * 100)));
}

/**
 * Renders the Pilot identity section (`#pilot`, W12-14):
 * avatar + frame, handle + rename link, Pilot ID (`<name>.terraagent.mock`),
 * "pilot since", level badge (`Level 4`), XP bar (`1 120 / 1 500`), and title (`Surveyor`).
 */
export function renderPilotSection(profile: MeProfileResponse): HTMLElement {
  const { identity, progression } = profile;
  const pilotIdText = identity.accountId ?? `${identity.handle}.terraagent.mock`;
  const pct = xpPercent(progression.xp, progression.currentLevelXp, progression.nextLevelXp);
  const xpLabel = `${formatThinInt(progression.xp)} / ${formatThinInt(progression.nextLevelXp)}`;

  const avatarGlyph = (identity.handle.trim()[0] ?? 'P').toUpperCase();
  const avatar = el(
    'div',
    {
      className: `plate-sm ta-pilot-avatar ta-frame-${identity.frame}`,
      dataset: { testid: 'me-pilot-avatar', frame: identity.frame },
    },
    el('span', { className: 'ta-pilot-avatar-glyph' }, avatarGlyph),
  );

  const nameRow = el(
    'div',
    { className: 'ta-pilot-name-row' },
    el('h3', { className: 'ta-pilot-handle', dataset: { testid: 'me-pilot-handle' } }, identity.handle),
    el(
      'span',
      { className: 'plate-sm ta-pilot-title-chip', dataset: { testid: 'me-pilot-title' } },
      progression.title,
    ),
    el(
      'a',
      {
        className: 'ta-pilot-rename label c-orange',
        href: '/play.html',
        dataset: { testid: 'me-pilot-rename' },
      },
      'Rename',
    ),
  );

  const metaRow = el(
    'div',
    { className: 'ta-pilot-meta-row' },
    el(
      'div',
      { className: 'ta-pilot-meta-item' },
      el('span', { className: 'label' }, 'PILOT ID'),
      el('span', { className: 'ta-pilot-id', dataset: { testid: 'me-pilot-id' } }, pilotIdText),
    ),
    el(
      'div',
      { className: 'ta-pilot-meta-item' },
      el('span', { className: 'label' }, 'PILOT SINCE'),
      el(
        'span',
        { className: 'ta-pilot-since', dataset: { testid: 'me-pilot-since' } },
        `Pilot since ${formatPilotSince(identity.pilotSince)}`,
      ),
    ),
  );

  const xpHeader = el(
    'div',
    { className: 'ta-pilot-xp-head' },
    el(
      'span',
      { className: 'plate-sm ta-pilot-level-badge', dataset: { testid: 'me-pilot-level' } },
      `Level ${progression.level}`,
    ),
    el(
      'span',
      { className: 'ta-pilot-xp-label', dataset: { testid: 'me-pilot-xp-text' } },
      `${xpLabel} XP`,
    ),
  );

  const xpBar = el(
    'div',
    {
      className: 'ta-pilot-xp-bar',
      role: 'progressbar',
      dataset: { testid: 'me-pilot-xp-bar' },
      aria: {
        valuemin: String(progression.currentLevelXp),
        valuemax: String(progression.nextLevelXp),
        valuenow: String(progression.xp),
        label: 'Pilot XP progress',
      },
    },
    el('div', { className: 'ta-pilot-xp-fill', style: { width: `${pct}%` } }),
    el('span', { className: 'ta-pilot-xp-bar-text' }, xpLabel),
  );

  return el(
    'div',
    { className: 'ta-pilot-body', dataset: { testid: 'me-pilot-body' } },
    el('div', { className: 'ta-pilot-identity' }, avatar, el('div', { className: 'ta-pilot-info' }, nameRow, metaRow)),
    el('div', { className: 'ta-pilot-xp-block' }, xpHeader, xpBar),
  );
}
