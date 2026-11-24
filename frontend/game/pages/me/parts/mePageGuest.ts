import {
  ACHIEVEMENTS,
  type MeAchievementsResponse,
  type MeProfileResponse,
} from '@terra/contracts';
import { el } from '../dom';
import { createBlockHelpTip } from './helpTip';

export function buildGuestPlaceholderData(): {
  readonly profile: MeProfileResponse;
  readonly achievements: MeAchievementsResponse;
} {
  const nowIso = new Date(0).toISOString();
  return {
    profile: {
      identity: {
        playerId: 'guest',
        handle: 'Guest Pilot',
        accountId: null,
        isGuest: true,
        pilotSince: nowIso,
        avatarSeed: 'guest',
        frame: 'default',
      },
      progression: {
        level: 1,
        xp: 0,
        currentLevelXp: 0,
        nextLevelXp: 500,
        title: 'Cadet',
        titles: ['Cadet'],
        frames: ['default'],
        unlockStage: 0,
        nextStageCondition: 'Sign in to track your colony progression.',
      },
      stats: {
        coloniesFounded: 0,
        coloniesSettled: 0,
        coloniesEliminated: 0,
        highestStageReached: 0,
        tilesGraded: 0,
        obstaclesRemoved: 0,
        waterTilesReclaimed: 0,
        livingTilesCreated: 0,
        buildingsCompleted: 0,
        peakNetPower: 0,
        nightsNoBrownout: 0,
        resourcesProduced: 0,
        faunaKilled: 0,
        nestsDestroyed: 0,
        raidsRepelled: 0,
        marketTradesSettled: 0,
      },
      currentColonies: [],
      pastColonies: [],
      nextAchievements: [],
      earnedAchievementsCount: 0,
      totalAchievementsCount: ACHIEVEMENTS.length,
    },
    achievements: {
      earnedCount: 0,
      totalCount: ACHIEVEMENTS.length,
      achievements: [],
    },
  };
}

export function disableGuestInternals(main: HTMLElement): void {
  main.classList.add('is-guest-disabled');
  main.dataset.guestDisabled = 'true';
  main.setAttribute('aria-disabled', 'true');
  main.setAttribute('inert', '');
  if ('inert' in main) (main as HTMLElement & { inert: boolean }).inert = true;

  for (const ctrl of main.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('button, input, select, textarea')) {
    if (!ctrl.disabled) ctrl.disabled = true;
    if (ctrl.getAttribute('aria-disabled') !== 'true') ctrl.setAttribute('aria-disabled', 'true');
    if (ctrl.tabIndex !== -1) ctrl.tabIndex = -1;
  }
  for (const node of main.querySelectorAll<HTMLElement>('a, [tabindex]')) {
    if (node.getAttribute('aria-disabled') !== 'true') node.setAttribute('aria-disabled', 'true');
    if (node.tabIndex !== -1) node.tabIndex = -1;
  }
}

export function renderMeSectionPlate(
  id: string,
  eyebrowText: string,
  children: HTMLElement | readonly HTMLElement[],
  tipDescription?: string,
): HTMLElement {
  const childList = Array.isArray(children) ? children : [children];
  const tip = tipDescription
    ? createBlockHelpTip({ id: `section-${id}`, title: eyebrowText, description: tipDescription })
    : null;
  return el(
    'section',
    {
      id,
      className: 'plate ta-me-section',
      tabIndex: -1,
      dataset: { testid: `me-section-${id}` },
    },
    el(
      'div',
      { className: 'ta-me-section-head' },
      el(
        'div',
        { className: 'ta-help-title-group' },
        tip ? tip.button : null,
        el(
          'h2',
          { className: 'label ta-me-eyebrow', dataset: { testid: `me-eyebrow-${id}` } },
          eyebrowText,
        ),
      ),
    ),
    tip ? tip.panel : null,
    ...childList,
  );
}

export function stripParamsFromWindowUrl(keys: readonly string[], searchOverride?: string): void {
  if (searchOverride !== undefined || typeof window === 'undefined' || !window.location) return;
  const params = new URLSearchParams(window.location.search);
  if (!keys.some((k) => params.has(k))) return;
  for (const k of keys) params.delete(k);
  const qs = params.toString();
  const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  window.history?.replaceState?.(null, '', nextUrl);
}

export function buildMeNavLinks(
  tabs: ReadonlyArray<{ readonly id: string; readonly label: string }>,
  stakingSectionId: string,
  guestDisabled: boolean,
): HTMLElement[] {
  return tabs.map((t) => {
    const baseCls = t.id === stakingSectionId ? 'ta-me-tab ta-me-tab--staking' : 'ta-me-tab';
    const link = el(
      'a',
      {
        className: guestDisabled ? `${baseCls} is-disabled` : baseCls,
        href: `#${t.id}`,
        ...(guestDisabled ? { tabIndex: -1 } : {}),
        dataset: {
          testid: `me-tab-${t.id}`,
          section: t.id,
          ...(guestDisabled ? { guestDisabled: 'true' } : {}),
        },
      },
      t.label,
    );
    if (guestDisabled) {
      link.setAttribute('aria-disabled', 'true');
      link.addEventListener('click', (e) => e.preventDefault());
    }
    return link;
  });
}
