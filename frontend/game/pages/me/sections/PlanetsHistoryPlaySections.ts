import {
  maxColoniesForTier,
  stakingTierFor,
  type ColonySlotAllowance,
  type CurrentColonySummary,
  type MeProfileResponse,
} from '@terra/contracts';
import { kindOfPlanetType } from '../../../../design/pilot/activeHomeColony';
import { el } from '../dom';

export interface PlanetsSectionController {
  syncStakerState(totalStakedNear: number): void;
}

export interface PlanetsPlayRenderOptions {
  readonly localHost?: boolean;
  readonly onReady?: (ctrl: PlanetsSectionController) => void;
}

function buildColonyDiveHref(
  colony: CurrentColonySummary,
  includeSector: boolean,
  localHost: boolean | undefined,
): string {
  const kind = kindOfPlanetType(colony.planetType);
  const params = new URLSearchParams();
  if (localHost) params.set('host', 'local');
  if (kind) params.set('planet', kind);
  if (!localHost || includeSector) {
    params.set('colonyId', colony.colonyId);
    if (includeSector && colony.foundingSectorId) params.set('sector', colony.foundingSectorId);
  }
  return `/play.html?${params.toString()}`;
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

function resolveProfileColonySlots(
  profile: MeProfileResponse,
  overrideStakedNear?: number,
): ColonySlotAllowance {
  const used = profile.currentColonies.length;
  if (overrideStakedNear !== undefined) {
    const clean = Math.max(0, Number.isFinite(overrideStakedNear) ? overrideStakedNear : 0);
    const tier = stakingTierFor(clean);
    const isStaker = tier.id >= 1 && tier.aiColonySlots > 0;
    const max = isStaker ? maxColoniesForTier(tier) : 1;
    return {
      used,
      max,
      aiColonySlots: tier.aiColonySlots,
      tier: tier.id,
      tierName: tier.name,
      stakedNear: clean.toFixed(6).replace(/\.?0+$/, '') || '0',
      isStaker,
    };
  }
  if (profile.colonySlots) return profile.colonySlots;
  const stakedNum = Number(profile.aiSettings?.stakedNear ?? '0') || 0;
  return resolveProfileColonySlots(profile, stakedNum);
}

function buildSlotsBanner(
  slots: ColonySlotAllowance,
  localHost: boolean | undefined,
): HTMLElement {
  const canFoundAnother = slots.used === 0 || (slots.isStaker && slots.used < slots.max);
  const deployHref =
    slots.used === 0
      ? localHost ? '/play.html?host=local' : '/play.html'
      : localHost ? '/play.html?host=local&new=1' : '/play.html?new=1';
  const summaryText =
    slots.aiColonySlots > 0
      ? `Tier ${slots.tier} ${slots.tierName} · ${slots.used} / ${slots.max} active colonies (${slots.aiColonySlots} NEAR.AI slot${slots.aiColonySlots === 1 ? '' : 's'}). Deploy across any planet or distinct sector — never two colonies in the same sector.`
      : `${slots.used} / ${slots.max} active colony (Free Cadet). Stake 50+ NEAR (Tier 2 Commander) to unlock 3 NEAR.AI colony slots across planets or distinct sectors.`;

  const actionNode = canFoundAnother
    ? el(
        'a',
        {
          className: 'btn btn-primary btn-sm',
          href: deployHref,
          dataset: { testid: 'me-deploy-new-colony' },
        },
        slots.used === 0 ? 'Deploy First Colony →' : `+ Deploy Colony (${slots.used}/${slots.max}) →`,
      )
    : el(
        'a',
        {
          className: 'btn btn-ghost btn-sm',
          href: '#staking',
          dataset: { testid: 'me-unlock-colony-slots' },
        },
        slots.tier >= 4 ? 'Max 12/12 Slots Active' : 'Stake NEAR for More Slots →',
      );

  return el(
    'div',
    {
      className: 'plate-sm ta-colony-slots-bar',
      dataset: {
        testid: 'me-colony-slots-bar',
        used: slots.used,
        max: slots.max,
        tier: slots.tier,
      },
    },
    el(
      'div',
      { className: 'ta-colony-slots-copy' },
      el(
        'span',
        { className: 'label c-orange', dataset: { testid: 'me-colony-slots-count' } },
        `ACTIVE COLONIES · ${slots.used} / ${slots.max}`,
      ),
      el('p', { className: 'ta-me-muted' }, summaryText),
    ),
    actionNode,
  );
}

export function renderPlanetsSection(
  profile: MeProfileResponse,
  opts: PlanetsPlayRenderOptions = {},
): HTMLElement {
  let bannerEl = buildSlotsBanner(resolveProfileColonySlots(profile), opts.localHost);
  const byPlanet = groupColoniesByPlanet(profile.currentColonies);
  const hasMultipleColonies = profile.currentColonies.length > 1;

  const currentCards = profile.currentColonies.map((c) => {
    const sectorTag = c.foundingSectorId ? ` · ${c.foundingSectorId}` : '';
    const diveHref = buildColonyDiveHref(c, hasMultipleColonies, opts.localHost);
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

  const root = el(
    'div',
    { className: 'ta-planets-body', dataset: { testid: 'me-planets-body' } },
    bannerEl,
    ...selectors,
    el('div', { className: 'ta-colony-grid' }, ...currentCards, ...pastCards),
  );

  opts.onReady?.({
    syncStakerState(totalStakedNear: number) {
      const nextBanner = buildSlotsBanner(
        resolveProfileColonySlots(profile, totalStakedNear),
        opts.localHost,
      );
      bannerEl.replaceWith(nextBanner);
      bannerEl = nextBanner;
    },
  });

  return root;
}

export function renderHistorySection(profile: MeProfileResponse): HTMLElement {
  const activeNoun = profile.currentColonies.length === 1 ? 'active colony' : 'active colonies';
  return el(
    'div',
    { className: 'ta-history-body', dataset: { testid: 'me-history-body' } },
    ...(profile.activity ?? []).map((n) =>
      el(
        'div',
        { className: 'plate-sm ta-colony-card' },
        el('strong', null, n.title),
        el('p', { className: 'ta-me-muted' }, new Date(n.createdAt).toLocaleString()),
      ),
    ),
    el(
      'p',
      { className: 'ta-me-muted' },
      `${profile.currentColonies.length} ${activeNoun} · ${profile.pastColonies.length} archived colonies. Latest achievement activity (up to 50).`,
    ),
  );
}

export function renderPlaySection(opts: PlanetsPlayRenderOptions = {}): HTMLElement {
  const playHref = opts.localHost ? '/play.html?host=local' : '/play.html';
  return el(
    'div',
    { className: 'ta-play-body', dataset: { testid: 'me-play-body' } },
    el('p', { className: 'ta-me-muted' }, 'Deploy to an orbital drop, switch sectors, or resume an active colony.'),
    el('a', { className: 'btn btn-primary', href: playHref, dataset: { testid: 'me-play-cta' } }, 'Play TerraAgent →'),
  );
}
