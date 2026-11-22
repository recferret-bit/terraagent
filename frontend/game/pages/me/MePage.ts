import type { MeAchievementsResponse, MeProfileResponse } from '@terra/contracts';
import { isLocalMockAuthEnabled } from '../../../design/pilot/localMockPilot';
import { consumeNearWalletCallback } from '../../../design/pilot/mockToken';
import { decodeNep413SocialToken } from '../../../design/pilot/nearAuthApi';
import { PilotAccess, type PilotAccessOptions, type PilotAccessSession } from '../../../design/pilot/PilotAccess';
import { clearMeCachedToken, fetchMeData, resolveMeBearerToken, type MeFetchFn } from './api';
import { clearChildren, el } from './dom';
import { createLocalModeFetch, isBrowserLocalHost } from './localModeSim';
import { createBlockHelpTip } from './parts/helpTip';
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

export class MePage {
  private headerAuth: PilotAccess | null = null;
  private promptAuth: PilotAccess | null = null;
  private readonly waveStakingOn: boolean;
  private readonly localHost: boolean;
  private readonly effectiveFetch?: MeFetchFn;
  /** Set while the signed-out view is showing (the staking tab bypasses the auth wall). */
  private unauthMessage: string | null = null;
  private hashListening = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: MountMePageOptions = {},
  ) {
    this.root.dataset.page = 'me';
    this.root.classList.add('ta-me-root');
    const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
    this.waveStakingOn = resolveClientFlags({ search, dev: Boolean(import.meta.env?.DEV), warn: () => undefined }).flags.has('W28');
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
      else this.scrollToStaking();
    });
  }

  private scrollToStaking(): void {
    if (this.waveStakingOn && parseStakingHash(this.currentHash()).active) {
      (this.root.querySelector('#staking') as HTMLElement | null)?.scrollIntoView?.();
    }
  }

  private renderStakingPlate(
    accountId: string | null,
    defaultPlanetId?: string,
    onStakingChange?: (totalStakedNear: number) => void,
  ): HTMLElement {
    const handle = renderStakingSection({
      amount: parseStakingHash(this.currentHash()).amount,
      defaultPlanetId,
      fetch: this.effectiveFetch,
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
      'Stake NEAR, stNEAR, or LiNEAR with 100% principal custody to earn net validator yield, unlock Managed NEAR.AI TEE slots, cut market taker fees, and compete for Planetary Patron seats.',
    );
    return plate;
  }

  /** Server-side fencing: the overview endpoint 404s with W28 off, so the staking tab and plate disappear. */
  private hideStaking(plate: HTMLElement): void {
    const main = plate.parentElement;
    plate.remove();
    this.root.querySelector<HTMLElement>('[data-testid="me-tab-staking"]')?.remove();
    // signed out on `#staking`: the preview was the whole page, so fall back to the normal sign-in prompt
    if (this.unauthMessage !== null && main && main.childElementCount === 0) main.replaceWith(this.renderAuthPrompt(this.unauthMessage));
  }

  /** Signed-out: the staking tab renders the public preview with no auth wall; every other hash keeps the prompt. */
  private renderUnauthenticated(message: string): void {
    this.unauthMessage = message;
    this.disposeAuthControls();
    clearChildren(this.root);
    this.root.appendChild(this.renderStickyNav({ skipRestore: true }));
    if (this.waveStakingOn && parseStakingHash(this.currentHash()).active) {
      const main = el('main', { className: 'ta-me-main', dataset: { testid: 'me-main' } });
      main.appendChild(this.renderStakingPlate(null));
      this.root.appendChild(main);
      return;
    }
    this.root.appendChild(this.renderAuthPrompt(message));
  }

  private disposeAuthControls(): void {
    this.headerAuth?.dispose();
    this.headerAuth = null;
    this.promptAuth?.dispose();
    this.promptAuth = null;
  }

  private async consumeRedirectLoginIfPresent(): Promise<void> {
    const walletHit = consumeNearWalletCallback();
    if (!walletHit) return;
    const doFetch: MeFetchFn = this.effectiveFetch ?? ((input, init) => fetch(input, init));
    try {
      const nep413 = decodeNep413SocialToken(walletHit.token);
      const res = await doFetch(nep413 ? '/v1/auth/near/verify' : '/v1/auth/social', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nep413 ?? walletHit),
      });
      if (!res.ok) return;
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
    } catch {
      /* ignore */
    }
  }

  async load(): Promise<void> {
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
      this.renderUnauthenticated(res.message);
      return;
    }

    if (res.kind === 'error') {
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
    this.root.appendChild(this.renderStickyNav({ initialSession, skipRestore: true }));

    const main = el('main', { className: 'ta-me-main', dataset: { testid: 'me-main' } });
    const defaultPlanetId =
      profile.currentColonies[0]?.planetId ?? (isLocalMockAuthEnabled() || this.localHost ? 'pl_local_prime' : undefined);
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
    if (this.waveStakingOn) {
      main.appendChild(
        this.renderStakingPlate(profile.identity.accountId ?? null, defaultPlanetId, (total) => {
          aiCtrl?.syncStakerState(total);
        }),
      );
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

    this.root.appendChild(main);
    this.scrollToStaking();
  }

  private renderStickyNav(
    navOpts: Pick<PilotAccessOptions, 'initialSession' | 'skipRestore'> & { readonly mountAuth?: boolean } = {},
  ): HTMLElement {
    const tabs = this.waveStakingOn
      ? [ME_SECTION_TABS[0], STAKING_TAB, ...ME_SECTION_TABS.slice(1)]
      : ME_SECTION_TABS;
    const links = tabs.map((t) =>
      el(
        'a',
        {
          className: t.id === STAKING_SECTION_ID ? 'ta-me-tab ta-me-tab--staking' : 'ta-me-tab',
          href: `#${t.id}`,
          dataset: { testid: `me-tab-${t.id}`, section: t.id },
        },
        t.label,
      ),
    );

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
