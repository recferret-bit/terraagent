import { ACHIEVEMENTS, resolveDefaultPatronagePlanetId, type MeAchievementsResponse, type MeProfileResponse } from '@terra/contracts';
import {
  consentedAuthHeaders, failAuthHttp, failAuthThrown, rememberAuthProvider, succeedAuth,
} from '../../../design/analytics/auth';
import { noteProfileLoadFailed, noteProfileSection, noteProfileViewed } from '../../../design/analytics/profile';
import { consumeNearWalletCallback } from '../../../design/pilot/mockToken';
import { decodeNep413SocialToken } from '../../../design/pilot/nearAuthApi';
import { PilotAccess, type PilotAccessOptions, type PilotAccessSession } from '../../../design/pilot/PilotAccess';
import { clearMeCachedToken, fetchMeData, resolveMeBearerToken, type MeFetchFn } from './api';
import { clearChildren, el } from './dom';
import { createLocalModeFetch, isBrowserLocalHost } from './localModeSim';
import { createBlockHelpTip } from './parts/helpTip';
import { attachMeTabNavigation, parseHashSectionId, type MeTabNavigationHandle } from './parts/tabScrollSpy';
import { renderAchievementsSection } from './sections/AchievementsSection';
import { renderAiSettingsSection, type AiSettingsController } from './sections/AiSettingsSection';
import { renderPilotSection } from './sections/PilotSection';
import {
  renderHistorySection,
  renderPlanetsSection,
  renderPlaySection,
} from './sections/PlanetsHistoryPlaySections';
import { renderProgressSection } from './sections/ProgressSection';
import { renderStatsSection } from './sections/StatsSection';
import { renderStakingSection } from './sections/staking/StakingSection';
import { parseStakingHash, STAKING_SECTION_ID } from './sections/staking/stakingRoute';
import { isProductionBuild } from '../../core/buildEnv';
import { resolveClientFlags } from '../../core/flags/resolve';

export const ME_SECTION_TABS = [
  { id: 'pilot', label: 'PILOT' },
  { id: 'progress', label: 'PROGRESS' },
  { id: 'planets', label: 'PLANETS' },
  { id: 'history', label: 'HISTORY' },
  { id: 'achievements', label: 'ACHIEVEMENTS' },
  { id: 'play', label: 'PLAY' },
] as const;

/** Shown only when wave `W28` is on (NEAR_STAKING_SPEC §2.2). */
export const STAKING_TAB = { id: STAKING_SECTION_ID, label: 'STAKING' } as const;

export interface MountMePageOptions {
  readonly fetch?: MeFetchFn;
  readonly search?: string;
  /** Test seam: the location hash (`#staking?amount=200`); defaults to `location.hash`. */
  readonly hash?: string;
}

function buildGuestPlaceholderData(): {
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

function disableGuestInternals(main: HTMLElement): void {
  main.classList.add('is-guest-disabled');
  main.dataset.guestDisabled = 'true';
  main.setAttribute('aria-disabled', 'true');
  main.setAttribute('inert', '');
  if ('inert' in main) (main as HTMLElement & { inert: boolean }).inert = true;

  for (const ctrl of main.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'button, input, select, textarea',
  )) {
    if (!ctrl.disabled) ctrl.disabled = true;
    if (ctrl.getAttribute('aria-disabled') !== 'true') ctrl.setAttribute('aria-disabled', 'true');
    if (ctrl.tabIndex !== -1) ctrl.tabIndex = -1;
  }
  for (const node of main.querySelectorAll<HTMLElement>('a, [tabindex]')) {
    if (node.getAttribute('aria-disabled') !== 'true') node.setAttribute('aria-disabled', 'true');
    if (node.tabIndex !== -1) node.tabIndex = -1;
  }
}

export class MePage {
  private headerAuth: PilotAccess | null = null;
  private promptAuth: PilotAccess | null = null;
  private tabNav: MeTabNavigationHandle | null = null;
  private guestObserver: MutationObserver | null = null;
  private hashAlignPending = false;
  private loadSeq = 0;
  private readonly waveStakingOn: boolean;
  private readonly localHost: boolean;
  private readonly effectiveFetch?: MeFetchFn;
  /** Set while the signed-out view is showing. */
  private unauthMessage: string | null = null;
  private hashListening = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: MountMePageOptions = {},
  ) {
    this.root.dataset.page = 'me';
    this.root.classList.add('ta-me-root');
    const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
    this.waveStakingOn = resolveClientFlags({ search, dev: !isProductionBuild() && Boolean(import.meta.env?.DEV), warn: () => undefined }).flags.has('W28');
    this.localHost = isBrowserLocalHost(search);
    this.effectiveFetch = opts.fetch ?? (this.localHost ? createLocalModeFetch() : undefined);
  }

  private currentHash(): string {
    return this.opts.hash ?? (typeof location !== 'undefined' ? location.hash : '');
  }

  private listenForHash(): void {
    if (this.hashListening || typeof window === 'undefined' || this.opts.hash !== undefined) return;
    this.hashListening = true;
    window.addEventListener('hashchange', () => {
      if (this.unauthMessage !== null) this.renderUnauthenticated(this.unauthMessage);
      else this.scrollToHashSection('smooth');
    });
  }

  private scrollToHashSection(behavior: ScrollBehavior = 'auto'): void {
    const hash = this.currentHash();
    const targetId = this.waveStakingOn && parseStakingHash(hash).active ? 'staking' : parseHashSectionId(hash);
    if (!targetId) return;
    if (this.tabNav?.scrollToSection(targetId, behavior)) return;
    const section = this.root.querySelector(`#${CSS?.escape ? CSS.escape(targetId) : targetId}`) as HTMLElement | null;
    section?.scrollIntoView?.({ behavior, block: 'start' });
  }

  private renderStakingPlate(
    accountId: string | null,
    defaultPlanetId?: string,
    onStakingChange?: (totalStakedNear: number) => void,
    fetchOverride?: MeFetchFn,
  ): { readonly plate: HTMLElement; readonly ready: Promise<void> } {
    const handle = renderStakingSection({
      amount: parseStakingHash(this.currentHash()).amount,
      defaultPlanetId,
      fetch: fetchOverride ?? this.effectiveFetch,
      search: this.opts.search,
      connected: accountId !== null,
      accountId,
      onConnect: () => this.headerAuth?.openSignInDialog(),
      onOff: () => this.hideStaking(plate),
      onStakingChange,
    });
    const plate = this.renderSectionPlate(
      STAKING_TAB.id,
      STAKING_TAB.label,
      handle.el,
    );
    return { plate, ready: handle.ready };
  }

  /** Server-side fencing: the overview endpoint 404s with W28 off, so the staking tab and plate disappear. */
  private hideStaking(plate: HTMLElement): void {
    plate.remove();
    this.root.querySelector<HTMLElement>('[data-testid="me-tab-staking"]')?.remove();
    this.mountTabNavigation();
  }

  private applyGuestLock(main: HTMLElement): void {
    disableGuestInternals(main);
    if (typeof MutationObserver !== 'undefined') {
      this.guestObserver?.disconnect();
      this.guestObserver = new MutationObserver(() => {
        disableGuestInternals(main);
      });
      this.guestObserver.observe(main, { childList: true, subtree: true });
    }
  }

  /** Signed-out: auth prompt is shown at top and all `/me` page internals & tabs are disabled until signed in. */
  private renderUnauthenticated(message: string): void {
    this.unauthMessage = message;
    this.disposeAuthControls();
    clearChildren(this.root);
    this.root.appendChild(this.renderStickyNav({ initialSession: null, skipRestore: true, guestDisabled: true }));
    this.root.appendChild(this.renderAuthPrompt(message));
    const guest = buildGuestPlaceholderData();
    const { main, stakingReady } = this.renderProfileSections(guest.profile, guest.achievements, {
      accountId: null,
      unauthenticated: true,
    });
    this.applyGuestLock(main);
    this.root.appendChild(main);
    this.mountTabNavigation();
    if (stakingReady) {
      void stakingReady.then(() => {
        if (main.isConnected && main.dataset.guestDisabled === 'true') disableGuestInternals(main);
      });
    }
  }

  private disposeAuthControls(): void {
    this.guestObserver?.disconnect();
    this.guestObserver = null;
    this.tabNav?.dispose();
    this.tabNav = null;
    this.headerAuth?.dispose();
    this.headerAuth = null;
    this.promptAuth?.dispose();
    this.promptAuth = null;
  }

  private mountTabNavigation(): void {
    this.tabNav?.dispose();
    this.tabNav = attachMeTabNavigation({
      root: this.root,
      initialHash: this.currentHash(),
      onSectionClick: (sectionId) => {
        this.hashAlignPending = false;
        noteProfileSection(sectionId);
      },
    });
  }

  private async consumeRedirectLoginIfPresent(): Promise<void> {
    const walletHit = consumeNearWalletCallback();
    if (!walletHit) return;
    const doFetch: MeFetchFn = this.effectiveFetch ?? ((input, init) => fetch(input, init));
    const nep413 = decodeNep413SocialToken(walletHit.token);
    rememberAuthProvider(walletHit.provider, nep413?.walletId);
    try {
      const res = await doFetch(nep413 ? '/v1/auth/near/verify' : '/v1/auth/social', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...consentedAuthHeaders() },
        body: JSON.stringify(nep413 ?? walletHit),
      });
      if (!res.ok) {
        failAuthHttp(res.status);
        return;
      }
      succeedAuth();
      const body = (await res.json()) as PilotAccessSession;
      if (!body?.accessToken || !body.player || body.accessToken === 'local-mode-token' || this.localHost) return;
      const isGuest = body.player.isGuest !== false;
      localStorage.setItem(
        'ta_active_pilot',
        JSON.stringify({
          playerId: body.player.id,
          accessToken: body.accessToken,
          updatedAt: Date.now(),
          isGuest,
          handle: body.player.handle,
          ...(body.accountId ? { accountId: body.accountId } : {}),
        }),
      );
      if (!isGuest) localStorage.setItem('ta_trade_token', body.accessToken);
    } catch (err) {
      failAuthThrown(err);
    }
  }

  async load(): Promise<void> {
    this.stripWaveParamsFromUrl();
    this.disposeAuthControls();
    clearChildren(this.root);
    this.root.appendChild(this.renderStickyNav({ mountAuth: false }));
    const loading = el(
      'div',
      { className: 'plate ta-me-loading', dataset: { testid: 'me-loading' } },
      'Loading pilot profile…',
    );
    this.root.appendChild(loading);

    await this.consumeRedirectLoginIfPresent();
    const res = await fetchMeData(this.effectiveFetch, this.opts.search);
    this.disposeAuthControls();
    clearChildren(this.root);

    if (res.kind === 'wave_disabled') {
      const returnHref = this.localHost ? '/play.html?host=local' : '/play.html';
      this.root.appendChild(
        el(
          'div',
          { className: 'plate ta-me-disabled', dataset: { testid: 'me-wave-disabled' } },
          el('h1', { className: 'ta-me-disabled-title' }, 'Player page is off'),
          el('p', { className: 'ta-me-muted' }, res.message),
          el('a', { className: 'btn btn-ghost btn-sm', href: returnHref }, 'Return to Game →'),
        ),
      );
      return;
    }

    this.unauthMessage = null;
    this.listenForHash();
    if (res.kind === 'unauthenticated') {
      noteProfileLoadFailed('unauthorized');
      this.renderUnauthenticated(res.message);
      return;
    }

    if (res.kind === 'error') {
      noteProfileLoadFailed(res.reason);
      this.root.appendChild(this.renderStickyNav({ skipRestore: true }));
      this.root.appendChild(
        el(
          'div',
          { className: 'plate ta-me-error', dataset: { testid: 'me-error' } },
          el('h1', { className: 'ta-me-disabled-title' }, 'Profile Unavailable'),
          el('p', { className: 'ta-me-muted' }, res.message),
        ),
      );
      return;
    }

    this.renderLoaded(res.profile, res.achievements);
  }

  private renderAuthPrompt(message: string): HTMLElement {
    const authSlot = el('div', { className: 'ta-ai-actions' });
    this.promptAuth = new PilotAccess(authSlot, {
      triggerLabel: 'Sign in / Sign up',
      skipRestore: true,
      fetch: this.effectiveFetch,
      allowOfflineLocalAuth: this.localHost,
      profileHref: this.localHost ? '/me.html?host=local' : undefined,
      onAuthChange: () => {
        this.clearDevQueryParamsOnAuthChange();
        void this.load();
      },
    });
    const landingHref =
      typeof location !== 'undefined' && location.hostname === 'play.terraagent.fun'
        ? 'https://terraagent.fun/'
        : '/landing.html';
    authSlot.appendChild(
      el('a', { className: 'btn btn-ghost btn-sm', href: landingHref }, '◂ Landing'),
    );
    return el(
      'div',
      { className: 'plate ta-me-error', dataset: { testid: 'me-auth-prompt' } },
      el('h1', { className: 'ta-me-disabled-title' }, 'Sign in or Sign up'),
      el('p', { className: 'ta-me-muted' }, message),
      authSlot,
    );
  }

  private renderProfileSections(
    profile: MeProfileResponse,
    achievements: MeAchievementsResponse,
    opts?: { readonly accountId?: string | null; readonly unauthenticated?: boolean },
  ): { readonly main: HTMLElement; readonly stakingReady: Promise<void> | null } {
    const main = el('main', { className: 'ta-me-main', dataset: { testid: 'me-main' } });
    const defaultPlanetId = resolveDefaultPatronagePlanetId(profile.currentColonies[0]?.planetId);
    let aiCtrl: AiSettingsController | null = null;

    main.appendChild(
      this.renderSectionPlate(
        'pilot',
        'PILOT',
        [
          renderPilotSection(profile, {
            fetch: this.effectiveFetch,
            search: this.opts.search,
            onRenamed: (nextHandle) => this.headerAuth?.setHandle(nextHandle),
          }),
          renderAiSettingsSection(profile, {
            fetch: this.effectiveFetch,
            search: this.opts.search,
            onReady: (ctrl) => {
              aiCtrl = ctrl;
            },
          }),
        ],
        'Your Pilot identity, progression XP, and NEAR.AI Bot Decision Manager settings.',
      ),
    );
    let stakingReady: Promise<void> | null = null;
    if (this.waveStakingOn) {
      const accountId = opts && 'accountId' in opts ? (opts.accountId ?? null) : (profile.identity.accountId ?? null);
      const stakingFetchOverride: MeFetchFn | undefined =
        opts?.unauthenticated && !parseStakingHash(this.currentHash()).active
          ? async () => ({ ok: false, status: 502, json: async () => ({}) })
          : undefined;
      const stk = this.renderStakingPlate(
        accountId,
        defaultPlanetId,
        (total) => {
          aiCtrl?.syncStakerState(total);
        },
        stakingFetchOverride,
      );
      main.appendChild(stk.plate);
      stakingReady = stk.ready;
    }
    main.appendChild(
      this.renderSectionPlate(
        'progress',
        'PROGRESS',
        [renderProgressSection(profile), renderStatsSection(profile.stats)],
      ),
    );
    main.appendChild(
      this.renderSectionPlate('planets', 'PLANETS', [renderPlanetsSection(profile, { localHost: this.localHost })]),
    );
    main.appendChild(
      this.renderSectionPlate('history', 'HISTORY', [renderHistorySection(profile)]),
    );
    main.appendChild(
      this.renderSectionPlate(
        'achievements',
        `ACHIEVEMENTS · ${achievements.earnedCount} / ${achievements.totalCount}`,
        [renderAchievementsSection(achievements)],
      ),
    );
    main.appendChild(
      this.renderSectionPlate('play', 'PLAY', [renderPlaySection({ localHost: this.localHost })]),
    );
    return { main, stakingReady };
  }

  renderLoaded(profile: MeProfileResponse, achievements: MeAchievementsResponse): void {
    this.disposeAuthControls();
    clearChildren(this.root);
    const isUnlinkedGuest = profile.identity.isGuest && !profile.identity.accountId;
    const initialSession: PilotAccessSession | null = isUnlinkedGuest
      ? null
      : {
          accessToken: resolveMeBearerToken(this.opts.search),
          ...(profile.identity.accountId ? { accountId: profile.identity.accountId } : {}),
          player: {
            id: profile.identity.playerId,
            handle: profile.identity.handle,
            isGuest: false,
          },
        };
    this.root.appendChild(
      this.renderStickyNav({ initialSession, skipRestore: true, guestDisabled: isUnlinkedGuest }),
    );
    if (isUnlinkedGuest) {
      this.root.appendChild(
        this.renderAuthPrompt('Sign in or create a pilot account to unlock your /me profile, colonies, and settings.'),
      );
    }

    const seq = ++this.loadSeq;
    const initialTarget = parseStakingHash(this.currentHash()).active ? 'staking' : parseHashSectionId(this.currentHash());
    this.hashAlignPending = Boolean(initialTarget && initialTarget !== 'pilot' && initialTarget !== 'staking');
    const { main, stakingReady } = this.renderProfileSections(profile, achievements);
    if (isUnlinkedGuest) {
      this.applyGuestLock(main);
    }

    this.root.appendChild(main);
    if (!isUnlinkedGuest) noteProfileViewed();
    this.mountTabNavigation();
    if (!isUnlinkedGuest) this.scrollToHashSection('auto');
    if (stakingReady && typeof window !== 'undefined') {
      const cancelAlign = (): void => { this.hashAlignPending = false; };
      if (!isUnlinkedGuest && this.hashAlignPending) {
        window.addEventListener('wheel', cancelAlign, { once: true, passive: true });
        window.addEventListener('touchstart', cancelAlign, { once: true, passive: true });
      }
      void stakingReady.then(() => {
        window.removeEventListener('wheel', cancelAlign);
        window.removeEventListener('touchstart', cancelAlign);
        if (isUnlinkedGuest && main.isConnected && main.dataset.guestDisabled === 'true') {
          disableGuestInternals(main);
        } else if (seq === this.loadSeq && this.hashAlignPending) {
          this.hashAlignPending = false;
          this.scrollToHashSection('auto');
        }
      });
    }
  }

  private renderStickyNav(
    navOpts: Pick<PilotAccessOptions, 'initialSession' | 'skipRestore'> & {
      readonly mountAuth?: boolean;
      readonly guestDisabled?: boolean;
    } = {},
  ): HTMLElement {
    const tabs = this.waveStakingOn
      ? [ME_SECTION_TABS[0], STAKING_TAB, ...ME_SECTION_TABS.slice(1)]
      : ME_SECTION_TABS;
    const guestDisabled = Boolean(navOpts.guestDisabled);
    const links = tabs.map((t) => {
      const baseCls = t.id === STAKING_SECTION_ID ? 'ta-me-tab ta-me-tab--staking' : 'ta-me-tab';
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

    const authHost = el('div', { dataset: { testid: 'me-header-auth' } });
    if (navOpts.mountAuth !== false) {
      this.headerAuth = new PilotAccess(authHost, {
        initialSession: navOpts.initialSession,
        skipRestore: navOpts.skipRestore,
        fetch: this.effectiveFetch,
        allowOfflineLocalAuth: this.localHost,
        profileHref: this.localHost ? '/me.html?host=local' : undefined,
        onAuthChange: (session) => {
          if (!session) clearMeCachedToken();
          this.clearDevQueryParamsOnAuthChange();
          void this.load();
        },
      });
    }

    const hubHref =
      typeof location !== 'undefined' && location.hostname === 'play.terraagent.fun'
        ? 'https://terraagent.fun/'
        : '/';
    return el(
      'header',
      { className: 'ta-me-header', dataset: { testid: 'me-sticky-tabs' } },
      el(
        'div',
        { className: 'ta-me-header-inner plate-sm' },
        el('a', { className: 'ta-me-brand label c-orange', href: hubHref }, 'TERRAAGENT // ME'),
        el('nav', { className: 'ta-me-tabs', aria: { label: 'Profile sections' } }, ...links),
        authHost,
      ),
    );
  }

  private stripWaveParamsFromUrl(): void {
    if (this.opts.search !== undefined || typeof window === 'undefined' || !window.location) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('waves') && !params.has('scenario')) return;
    params.delete('waves');
    params.delete('scenario');
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history?.replaceState?.(null, '', nextUrl);
  }

  private clearDevQueryParamsOnAuthChange(): void {
    if (this.opts.search !== undefined || typeof window === 'undefined' || !window.location) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('as') && !params.has('playerId')) return;
    params.delete('as');
    params.delete('playerId');
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history?.replaceState?.(null, '', nextUrl);
  }

  private renderSectionPlate(
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
}

export function mountMePage(root: HTMLElement, opts: MountMePageOptions = {}): MePage {
  const page = new MePage(root, opts);
  void page.load();
  return page;
}
