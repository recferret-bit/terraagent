import type { MeAchievementsResponse, MeProfileResponse } from '@terra/contracts';
import { fetchMeData, type MeFetchFn } from './api';
import { clearChildren, el } from './dom';
import { renderAchievementsSection } from './sections/AchievementsSection';
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
  constructor(
    private readonly root: HTMLElement,
    private readonly opts: MountMePageOptions = {},
  ) {
    this.root.dataset.page = 'me';
    this.root.classList.add('ta-me-root');
  }

  async load(): Promise<void> {
    clearChildren(this.root);
    this.root.appendChild(this.renderStickyNav());
    const loading = el(
      'div',
      { className: 'plate ta-me-loading', dataset: { testid: 'me-loading' } },
      'Loading pilot profile…',
    );
    this.root.appendChild(loading);

    const res = await fetchMeData(this.opts.fetch, this.opts.search);
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

    if (res.kind === 'error') {
      this.root.appendChild(this.renderStickyNav());
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

  renderLoaded(profile: MeProfileResponse, achievements: MeAchievementsResponse): void {
    clearChildren(this.root);
    this.root.appendChild(this.renderStickyNav());

    const main = el('main', { className: 'ta-me-main', dataset: { testid: 'me-main' } });

    main.appendChild(
      this.renderSectionPlate('pilot', 'PILOT', renderPilotSection(profile)),
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

  private renderStickyNav(): HTMLElement {
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

    return el(
      'header',
      { className: 'ta-me-header', dataset: { testid: 'me-sticky-tabs' } },
      el(
        'div',
        { className: 'ta-me-header-inner plate-sm' },
        el('a', { className: 'ta-me-brand label c-orange', href: '/' }, 'TERRAAGENT // ME'),
        el('nav', { className: 'ta-me-tabs', aria: { label: 'Profile sections' } }, ...links),
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
