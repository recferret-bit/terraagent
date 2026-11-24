import type { CurrentColonySummary, MeProfileResponse } from '@terra/contracts';
import { el } from '../dom';

export interface PlanetsPlayRenderOptions {
  readonly localHost?: boolean;
}

function buildColonyDiveHref(
  colony: CurrentColonySummary,
  includeSector: boolean,
  localHost: boolean | undefined,
): string {
  const sector = includeSector && colony.foundingSectorId
    ? `&sector=${encodeURIComponent(colony.foundingSectorId)}`
    : '';
  if (localHost) {
    return includeSector
      ? `/play.html?host=local&skip=1&colonyId=${encodeURIComponent(colony.colonyId)}${sector}`
      : '/play.html?host=local&skip=1';
  }
  return `/play.html?skip=1&colonyId=${encodeURIComponent(colony.colonyId)}${sector}`;
}

function groupColoniesByPlanet(
  colonies: readonly CurrentColonySummary[],
): Map<string, CurrentColonySummary[]> {
  const byPlanet = new Map<string, CurrentColonySummary[]>();
  for (const c of colonies) {
    let list = byPlanet.get(c.planetId);
    if (!list) byPlanet.set(c.planetId, (list = []));
    list.push(c);
  }
  return byPlanet;
}

function buildSamePlanetSelector(
  planetId: string,
  coloniesOnPlanet: readonly CurrentColonySummary[],
  localHost: boolean | undefined,
  getCards: () => readonly HTMLElement[],
): HTMLElement {
  let selectedId = coloniesOnPlanet[0]!.colonyId;
  const selectEl = document.createElement('select');
  selectEl.className = 'input ta-same-planet-select';
  selectEl.dataset.testid = 'me-same-planet-select';
  selectEl.setAttribute('aria-label', `Select active colony on ${coloniesOnPlanet[0]!.planetName}`);
  for (const c of coloniesOnPlanet) {
    const opt = document.createElement('option');
    opt.value = c.colonyId;
    const secLabel = (c.foundingSectorId ?? 'sec_0_0').toUpperCase();
    opt.textContent = `${c.name} · ${secLabel} · S${c.stage}`;
    selectEl.appendChild(opt);
  }

  const diveLink = el(
    'a',
    {
      className: 'btn btn-primary btn-sm ta-same-planet-dive',
      href: buildColonyDiveHref(coloniesOnPlanet[0]!, true, localHost),
      dataset: { testid: 'me-same-planet-dive' },
    },
    `Dive into ${coloniesOnPlanet[0]!.name} →`,
  ) as HTMLAnchorElement;

  const optionBtns = coloniesOnPlanet.map((c) => {
    const secLabel = (c.foundingSectorId ?? 'sec_0_0').toUpperCase();
    return el(
      'button',
      {
        type: 'button',
        className: 'btn btn-sm ta-same-planet-opt',
        dataset: { testid: 'me-same-planet-option', colonyId: c.colonyId },
      },
      `${c.name} · ${secLabel} · S${c.stage}`,
    ) as HTMLButtonElement;
  });

  const syncSelection = (nextId: string): void => {
    const picked = coloniesOnPlanet.find((c) => c.colonyId === nextId) ?? coloniesOnPlanet[0]!;
    selectedId = picked.colonyId;
    selectEl.value = selectedId;
    diveLink.href = buildColonyDiveHref(picked, true, localHost);
    diveLink.textContent = `Dive into ${picked.name} →`;
    for (const btn of optionBtns) {
      const on = btn.dataset.colonyId === selectedId;
      btn.classList.toggle('btn-primary', on);
      btn.classList.toggle('btn-ghost', !on);
      btn.classList.toggle('sel', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const card of getCards()) {
      if (card.dataset.planetId !== planetId) continue;
      card.classList.toggle('is-selected-colony', card.dataset.colonyId === selectedId);
    }
  };

  selectEl.addEventListener('change', () => syncSelection(selectEl.value));
  for (const btn of optionBtns) {
    btn.addEventListener('click', () => {
      if (btn.dataset.colonyId) syncSelection(btn.dataset.colonyId);
    });
  }
  syncSelection(selectedId);

  return el(
    'div',
    {
      className: 'plate-sm ta-same-planet-selector',
      dataset: { testid: 'me-same-planet-selector', planetId },
    },
    el(
      'div',
      { className: 'ta-same-planet-head' },
      el('span', { className: 'label c-orange' }, `${coloniesOnPlanet[0]!.planetName} · ${coloniesOnPlanet.length} Active Colonies on This World`),
      el('p', { className: 'ta-me-muted' }, 'Choose which sector and colony to enter directly:'),
    ),
    el('div', { className: 'ta-same-planet-options' }, ...optionBtns),
    el('div', { className: 'ta-same-planet-controls' }, selectEl, diveLink),
  );
}

export function renderPlanetsSection(
  profile: MeProfileResponse,
  opts: PlanetsPlayRenderOptions = {},
): HTMLElement {
  const byPlanet = groupColoniesByPlanet(profile.currentColonies);

  const currentCards = profile.currentColonies.map((c) => {
    const multiOnPlanet = (byPlanet.get(c.planetId)?.length ?? 0) > 1;
    const sectorTag = c.foundingSectorId ? ` · ${c.foundingSectorId}` : '';
    const diveHref = buildColonyDiveHref(c, multiOnPlanet, opts.localHost);
    return el(
      'div',
      {
        className: 'plate-sm ta-colony-card',
        dataset: { testid: 'me-current-colony', colonyId: c.colonyId, planetId: c.planetId },
      },
      el('div', { className: 'ta-colony-head' }, el('strong', null, c.name), el('span', { className: 'label c-terra' }, `S${c.stage}`)),
      el('p', { className: 'ta-colony-meta' }, `${c.planetName} · ${c.planetType}${sectorTag}`),
      el('a', { className: 'btn btn-primary btn-sm', href: diveHref, dataset: { testid: 'me-colony-dive-in' } }, 'Dive in'),
    );
  });

  const selectors: HTMLElement[] = [];
  for (const [planetId, list] of byPlanet) {
    if (list.length > 1) {
      selectors.push(buildSamePlanetSelector(planetId, list, opts.localHost, () => currentCards));
    }
  }

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
    ...selectors,
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

export function renderPlaySection(opts: PlanetsPlayRenderOptions = {}): HTMLElement {
  const playHref = opts.localHost ? '/play.html?host=local' : '/play.html';
  return el(
    'div',
    { className: 'ta-play-body', dataset: { testid: 'me-play-body' } },
    el('p', { className: 'ta-me-muted' }, 'Deploy to an orbital drop or resume your active colony.'),
    el('a', { className: 'btn btn-primary', href: playHref, dataset: { testid: 'me-play-cta' } }, 'Play TerraAgent →'),
  );
}
