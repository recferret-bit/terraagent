import type { PlayerAchievementEntry } from '@terra/contracts';
import { el, formatThinInt } from '../dom';
import { getAchievementLore, ROMAN_TIER } from './achievementLore';
import './card-states.css';

export function formatEarnedDate(iso: string | null): string {
  if (!iso) return 'Earned';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function buildShareIntentUrl(entry: PlayerAchievementEntry, pageUrl = 'https://terraagent.com/me'): string {
  const text = `Unlocked ${entry.familyName} (${entry.tierName} · +${entry.xp} XP) in TerraAgent!`;
  const params = new URLSearchParams({ text, url: pageUrl });
  return `https://x.com/intent/tweet?${params.toString()}`;
}

export function renderProgressBar(value: number, target: number): HTMLElement {
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
  const label = `${formatThinInt(value)} / ${formatThinInt(target)} (${pct}%)`;
  return el(
    'div',
    {
      className: 'ta-ach-progress-bar',
      role: 'progressbar',
      dataset: { testid: 'ach-progress-bar' },
      aria: {
        valuemin: '0',
        valuemax: String(target),
        valuenow: String(value),
      },
    },
    el('div', { className: 'ta-ach-progress-fill', style: { width: `${pct}%` } }),
    el('span', { className: 'ta-ach-progress-label' }, label),
  );
}

export function renderCardFrontFace(
  entry: PlayerAchievementEntry,
  isNextToEarn: boolean,
): HTMLElement {
  const isEarned = entry.status === 'earned';
  const isComingSoon = entry.status === 'coming_soon';
  const imgSrc = isEarned
    ? `/img/achievements/${encodeURIComponent(entry.id)}.svg`
    : `/img/achievements/${encodeURIComponent(entry.id)}-locked.svg`;

  const artWrap = el(
    'div',
    { className: `ta-ach-art-wrap${isEarned ? ' is-earned' : ' is-locked'}` },
    el('img', {
      className: 'ta-ach-art-img',
      src: imgSrc,
      alt: `${entry.familyName} ${entry.tierName}`,
      width: 240,
      height: 240,
      dataset: { testid: 'ach-card-art' },
    }),
  );

  const headRow = el(
    'div',
    { className: 'ta-ach-front-head' },
    el('span', { className: 'ta-ach-tier-label', dataset: { testid: 'ach-tier-label' } }, entry.tierName.toUpperCase()),
    el('span', { className: 'label ta-ach-xp-pill' }, `+${entry.xp} XP`),
  );

  const titleEl = el('h4', { className: 'ta-ach-title' }, entry.familyName);
  const descEl =
    isNextToEarn || isEarned
      ? el('p', { className: 'ta-ach-desc', dataset: { testid: 'ach-front-desc' } }, entry.description)
      : null;

  let footerEl: HTMLElement;
  if (isEarned) {
    footerEl = el(
      'div',
      { className: 'ta-ach-earned-footer', dataset: { testid: 'ach-earned-badge' } },
      el('span', { className: 'ta-ach-earned-check' }, `✓ ${formatEarnedDate(entry.earnedAt)}`),
      el('span', { className: 'label c-terra' }, 'EARNED'),
    );
  } else if (isComingSoon) {
    footerEl = el(
      'div',
      { className: 'ta-ach-coming-soon', dataset: { testid: 'ach-coming-soon' } },
      'Coming soon',
    );
  } else {
    footerEl = renderProgressBar(entry.progress.value, entry.progress.target);
  }

  return el(
    'div',
    { dataset: { testid: `ach-front-${entry.id}` } },
    headRow,
    artWrap,
    el('div', { className: 'ta-ach-front-info' }, titleEl, descEl),
    footerEl,
  );
}

function formatNftStatusText(entry: PlayerAchievementEntry): string {
  if (entry.status !== 'earned') return 'Badge locked';
  if (entry.nft.status === 'minted') {
    const isMock = !entry.nft.txHash || entry.nft.txHash.startsWith('mock:');
    return isMock ? 'Recorded (mock)' : 'Recorded on NEAR';
  }
  if (entry.nft.status === 'pending') {
    return 'Badge minting…';
  }
  return 'Recorded (mock)';
}

export function renderCardBackFace(entry: PlayerAchievementEntry): HTMLElement {
  const isEarned = entry.status === 'earned';
  const isComingSoon = entry.status === 'coming_soon';
  const romanTier = ROMAN_TIER[entry.tier] ?? String(entry.tier);
  const loreText = getAchievementLore(entry);

  const topBlock = el(
    'div',
    { className: 'ta-ach-back-top' },
    el(
      'div',
      { className: 'ta-ach-front-head' },
      el('span', { className: 'ta-ach-tier-label' }, entry.tierName.toUpperCase()),
      el('span', { className: 'label c-orange' }, `+${entry.xp} XP`),
    ),
    el('h4', { className: 'ta-ach-title' }, entry.familyName),
    el('p', { className: 'ta-ach-desc', dataset: { testid: 'ach-back-desc' } }, entry.description),
    el(
      'p',
      { className: 'ta-ach-threshold' },
      `Target threshold: ${formatThinInt(entry.threshold)}`,
    ),
  );

  const loreBlock = el(
    'div',
    { className: 'ta-ach-lore', dataset: { testid: 'ach-back-lore' } },
    el(
      'span',
      { className: 'ta-ach-lore-eyebrow' },
      `RELIC INSCRIPTION · TIER ${romanTier}`,
    ),
    el('blockquote', { className: 'ta-ach-lore-text' }, loreText),
  );

  let bottomBlock: HTMLElement;
  if (isEarned) {
    const shareHref = buildShareIntentUrl(entry);
    bottomBlock = el(
      'div',
      { className: 'ta-ach-back-bottom' },
      el(
        'div',
        { className: 'ta-ach-back-meta' },
        el('span', { className: 'ta-ach-earned-check' }, `Earned ${formatEarnedDate(entry.earnedAt)}`),
        el('span', { className: 'ta-ach-nft-status', dataset: { testid: 'ach-nft-status' } }, formatNftStatusText(entry)),
      ),
      el(
        'a',
        {
          className: 'btn btn-primary btn-sm ta-ach-share-btn',
          href: shareHref,
          target: '_blank',
          rel: 'noopener noreferrer',
          dataset: { testid: 'ach-share-btn' },
        },
        'Share',
      ),
    );
  } else if (isComingSoon) {
    bottomBlock = el(
      'div',
      { className: 'ta-ach-back-bottom' },
      el('span', { className: 'ta-ach-coming-soon' }, 'Coming soon'),
    );
  } else {
    bottomBlock = el(
      'div',
      { className: 'ta-ach-back-bottom' },
      renderProgressBar(entry.progress.value, entry.progress.target),
    );
  }

  return el('div', { dataset: { testid: `ach-back-${entry.id}` } }, topBlock, loreBlock, bottomBlock);
}
