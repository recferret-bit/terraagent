import type { MeAchievementsResponse, MeProfileResponse } from '@terra/contracts';
import { consumeNearWalletCallback } from '../../../design/pilot/mockToken';
import { PilotAccess, type PilotAccessOptions, type PilotAccessSession } from '../../../design/pilot/PilotAccess';
import { clearMeCachedToken, fetchMeData, resolveMeBearerToken, type MeFetchFn } from './api';
import { clearChildren, el } from './dom';
import { renderAchievementsSection } from './sections/AchievementsSection';
import { renderAiSettingsSection } from './sections/AiSettingsSection';
import { renderPilotSection } from './sections/PilotSection';
import {
  renderHistorySection,
  renderPlanetsSection,
  renderPlaySection,
} from './sections/PlanetsHistoryPlaySections';
import { renderProgressSection } from './sections/ProgressSection';
import { renderStatsSection } from './sections/StatsSection';

export const ME_SECTION_TABS = [
  { id: 'pilot', label: 'PILOT' },
  { id: 'progress', label: 'PROGRESS' },
  { id: 'planets', label: 'PLANETS' },
  { id: 'history', label: 'HISTORY' },
  { id: 'achievements', label: 'ACHIEVEMENTS' },
  { id: 'play', label: 'PLAY' },
] as const;

export interface MountMePageOptions {
  readonly fetch?: MeFetchFn;
  readonly search?: string;
}

export class MePage {
  private headerAuth: PilotAccess | null = null;
  private promptAuth: PilotAccess | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: MountMePageOptions = {},
  ) {
    this.root.dataset.page = 'me';
    this.root.classList.add('ta-me-root');
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
    const doFetch: MeFetchFn = this.opts.fetch ?? ((input, init) => fetch(input, init));
    try {
      const res = await doFetch('/v1/auth/social', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(walletHit),
      });
      if (!res.ok) return;
      const body = (await res.json()) as PilotAccessSession;
      if (!body?.accessToken || !body.player) return;
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
    const res = await fetchMeData(this.opts.fetch, this.opts.search);
    this.disposeAuthControls();
    clearChildren(this.root);

    if (res.kind === 'wave_disabled') {
      this.root.appendChild(
        el(
          'div',
          { className: 'plate ta-me-disabled', dataset: { testid: 'me-wave-disabled' } },
          el('h1', { className: 'ta-me-disabled-title' }, 'Player page is off'),
          el('p', { className: 'ta-me-muted' }, res.message),
          el('a', { className: 'btn btn-ghost btn-sm', href: '/play.html' }, 'Return to Game →'),
        ),
      );
      return;
    }

    if (res.kind === 'unauthenticated') {
      this.root.appendChild(this.renderStickyNav({ skipRestore: true }));
      this.root.appendChild(this.renderAuthPrompt(res.message));
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
      onAuthChange: () => {
        void this.load();
      },
    });
    authSlot.appendChild(
      el('a', { className: 'btn btn-ghost btn-sm', href: '/landing.html' }, '◂ Landing'),
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

    main.appendChild(
      this.renderSectionPlate(
        'pilot',
        'PILOT',
        renderPilotSection(profile),
        renderAiSettingsSection(profile, { fetch: this.opts.fetch, search: this.opts.search }),
      ),
    );
    main.appendChild(
      this.renderSectionPlate(
        'progress',
        'PROGRESS',
        renderProgressSection(profile),
        renderStatsSection(profile.stats),
      ),
    );
    main.appendChild(
      this.renderSectionPlate('planets', 'PLANETS', renderPlanetsSection(profile)),
    );
    main.appendChild(
      this.renderSectionPlate('history', 'HISTORY', renderHistorySection(profile)),
    );
    main.appendChild(
      this.renderSectionPlate(
        'achievements',
        `ACHIEVEMENTS · ${achievements.earnedCount} / ${achievements.totalCount}`,
        renderAchievementsSection(achievements),
      ),
    );
    main.appendChild(
      this.renderSectionPlate('play', 'PLAY', renderPlaySection()),
    );

    this.root.appendChild(main);
  }

  private renderStickyNav(
    navOpts: Pick<PilotAccessOptions, 'initialSession' | 'skipRestore'> & { readonly mountAuth?: boolean } = {},
  ): HTMLElement {
    const links = ME_SECTION_TABS.map((t) =>
      el(
        'a',
        {
          className: 'ta-me-tab',
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
        onAuthChange: (session) => {
          if (!session) clearMeCachedToken();
          void this.load();
        },
      });
    }

    return el(
      'header',
      { className: 'ta-me-header', dataset: { testid: 'me-sticky-tabs' } },
      el(
        'div',
        { className: 'ta-me-header-inner plate-sm' },
        el('a', { className: 'ta-me-brand label c-orange', href: '/' }, 'TERRAAGENT // ME'),
        el('nav', { className: 'ta-me-tabs', aria: { label: 'Profile sections' } }, ...links),
        authHost,
      ),
    );
  }

  private renderSectionPlate(
    id: string,
    eyebrowText: string,
    ...children: HTMLElement[]
  ): HTMLElement {
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
          'h2',
          { className: 'label ta-me-eyebrow', dataset: { testid: `me-eyebrow-${id}` } },
          eyebrowText,
        ),
      ),
      ...children,
    );
  }
}

export function mountMePage(root: HTMLElement, opts: MountMePageOptions = {}): MePage {
  const page = new MePage(root, opts);
  void page.load();
  return page;
}
