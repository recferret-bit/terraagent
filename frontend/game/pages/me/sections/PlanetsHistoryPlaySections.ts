import type { MeProfileResponse } from '@terra/contracts';
import { el } from '../dom';

export function renderPlanetsSection(profile: MeProfileResponse): HTMLElement {
  const currentCards = profile.currentColonies.map((c) =>
    el(
      'div',
      { className: 'plate-sm ta-colony-card', dataset: { testid: 'me-current-colony', colonyId: c.colonyId } },
      el('div', { className: 'ta-colony-head' }, el('strong', null, c.name), el('span', { className: 'label c-terra' }, `S${c.stage}`)),
      el('p', { className: 'ta-colony-meta' }, `${c.planetName} · ${c.planetType}`),
      el('a', { className: 'btn btn-primary btn-sm', href: c.colonyId.startsWith('co_w12_') ? '/play.html?scenario=w12&as=w12' : `/play.html?skip=1&colonyId=${encodeURIComponent(c.colonyId)}`, dataset: { testid: 'me-colony-dive-in' } }, 'Dive in'),
    ),
  );

  const pastCards = profile.pastColonies.map((c) =>
    el(
      'div',
      { className: 'plate-sm ta-colony-card ta-colony-past', dataset: { testid: 'me-past-colony', outcome: c.outcome } },
      el('div', { className: 'ta-colony-head' }, el('strong', null, c.name), el('span', { className: 'label' }, c.outcome.toUpperCase())),
      el('p', { className: 'ta-colony-meta' }, `${c.planetName} · ${c.planetType} · Reached S${c.stageReached}`),
    ),
  );

  return el(
    'div',
    { className: 'ta-planets-body', dataset: { testid: 'me-planets-body' } },
    el('div', { className: 'ta-colony-grid' }, ...currentCards, ...pastCards),
  );
}

export function renderHistorySection(profile: MeProfileResponse): HTMLElement {
  return el(
    'div',
    { className: 'ta-history-body', dataset: { testid: 'me-history-body' } },
    ...(profile.activity ?? []).map(n => el('div', { className: 'plate-sm ta-colony-card' }, el('strong', null, n.title), el('p', { className: 'ta-me-muted' }, new Date(n.createdAt).toLocaleString()))),
    el(
      'p',
      { className: 'ta-me-muted' },
      `${profile.currentColonies.length} active colony · ${profile.pastColonies.length} archived colonies. Latest achievement activity (up to 50).`,
    ),
  );
}

export function renderPlaySection(): HTMLElement {
  return el(
    'div',
    { className: 'ta-play-body', dataset: { testid: 'me-play-body' } },
    el('p', { className: 'ta-me-muted' }, 'Deploy to an orbital drop or resume your active colony.'),
    el('a', { className: 'btn btn-primary', href: '/play.html', dataset: { testid: 'me-play-cta' } }, 'Play TerraAgent →'),
  );
}
