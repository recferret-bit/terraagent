import type { AnalyticsHudBook, AnalyticsHudPanel, AnalyticsUiArea } from '@terra/contracts';
import { currentSurface, pathGroup, runtimeLabel, type AnalyticsSurface } from './context';
import { trackProduct } from './trackSafe';
import {
  classifyByDataAttr, classifyByTestIdPrefix, ID_MATCHERS, TESTID_MATCHERS, type UiRuleMatch,
} from './uiRules';

export type { UiRuleMatch };

const NON_TOKEN = /[^A-Za-z0-9._-]+/g;

let delegated = false;

export function sanitizeUiToken(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(NON_TOKEN, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  return cleaned || undefined;
}

export function noteUiAction(
  area: AnalyticsUiArea,
  action: string,
  target?: string,
  surfaceOverride?: AnalyticsSurface,
): void {
  const surface = surfaceOverride ?? currentSurface();
  const cleanAction = sanitizeUiToken(action);
  if (!surface || !cleanAction) return;
  const cleanTarget = sanitizeUiToken(target);
  trackProduct('ui_action_clicked', {
    surface,
    area,
    action: cleanAction,
    ...(cleanTarget ? { target: cleanTarget } : {}),
    runtime: runtimeLabel(),
  });
}

export function noteHudPanelOpened(book: AnalyticsHudBook, panel: AnalyticsHudPanel): void {
  trackProduct('hud_panel_opened', {
    book,
    panel,
    runtime: runtimeLabel(),
  });
}

function resolveCrossOriginTarget(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (url.hash === '#staking' || url.hash.startsWith('#staking?')) return 'staking';
  if (host === 'terraagent.fun' || host === 'www.terraagent.fun') {
    const group = pathGroup(url.pathname, 'landing');
    return group === 'landing' && url.hash ? sanitizeUiToken(url.hash.slice(1)) ?? 'landing' : group;
  }
  if (host.endsWith('.terraagent.fun')) {
    const sub = host.split('.')[0] || 'terraagent';
    const group = pathGroup(url.pathname, sub);
    return group === 'other' ? sub : group;
  }
  return 'external';
}

function resolveLinkTarget(href: string): string {
  try {
    const base = typeof location !== 'undefined' ? location.origin : 'https://terraagent.fun';
    const url = new URL(href, base);
    if (url.origin !== base) return resolveCrossOriginTarget(url);
    if (url.hash === '#staking' || url.hash.startsWith('#staking?')) return 'staking';
    const group = pathGroup(url.pathname, 'hub');
    return group === 'hub' && url.hash ? sanitizeUiToken(url.hash.slice(1)) ?? 'hub' : group;
  } catch {
    return 'link';
  }
}

export function classifyClickedControl(el: HTMLElement, surface: AnalyticsSurface): UiRuleMatch | null {
  const byAttr = classifyByDataAttr(el, surface);
  if (byAttr) return byAttr;

  const testid = el.dataset.testid;
  if (testid) {
    if (TESTID_MATCHERS[testid]) return TESTID_MATCHERS[testid];
    const byPrefix = classifyByTestIdPrefix(testid);
    if (byPrefix) return byPrefix;
  }
  if (el.id && ID_MATCHERS[el.id]) return ID_MATCHERS[el.id];
  if (el.classList.contains('pitch-dot')) return { area: 'slides', action: 'slide_dot' };
  if (el.classList.contains('btn-play-header')) return { area: 'nav', action: 'play_cta', target: 'play' };
  if (el.tagName === 'SUMMARY' && surface === 'landing') return { area: 'cta', action: 'toggle_faq' };
  if (el.tagName === 'SUMMARY' && surface === 'whitepaper') return { area: 'cta', action: 'toggle_canonical_draft' };
  if (surface === 'trade' && el.classList.contains('tr-linkbtn')) {
    return { area: 'market', action: 'select_pair', target: sanitizeUiToken(el.textContent) };
  }
  if (surface === 'trade' && el.closest('.tr-planetform')) {
    return { area: 'nav', action: 'switch_planet' };
  }

  if (el.tagName === 'A') {
    const href = el.getAttribute('href');
    if (href) {
      const linkTarget = resolveLinkTarget(href);
      if (surface === 'hub') {
        if (el.classList.contains('cover')) return { area: 'hub', action: 'open_door_card', target: linkTarget };
        if (el.closest('.quick')) return { area: 'hub', action: 'quick_link', target: linkTarget };
      }
      if (surface === 'design' && el.classList.contains('card')) {
        return { area: 'design', action: 'open_card', target: linkTarget };
      }
      if (
        el.classList.contains('btn')
        || el.classList.contains('scenarios-cta')
        || (surface === 'landing' && Boolean(el.closest('details')))
        || el.closest('nav, header, footer, .hero-actions, .econ-cta-bar, .cta-row, .pitch-actions, .ta-deed-share-actions')
      ) {
        const area: AnalyticsUiArea = el.closest('nav, header') ? 'nav' : 'cta';
        return { area, action: 'navigate', target: linkTarget };
      }
    }
  }
  return null;
}

const UI_CLICK_KEY = Symbol.for('terra.analytics.uiClickHandler');

export function installUiActionDelegation(surface: AnalyticsSurface): void {
  if (delegated || typeof document === 'undefined') return;
  delegated = true;
  const docAny = document as unknown as Record<symbol, ((event: Event) => void) | undefined>;
  const prev = docAny[UI_CLICK_KEY];
  if (prev) document.removeEventListener('click', prev, true);
  const handler = (event: Event): void => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    if (rawTarget.closest('[data-testid="analytics-consent"]')) return;
    const control = rawTarget.closest<HTMLElement>('button, a[href], summary, [role="tab"], [data-ta-action]');
    if (!control) return;
    if ((control as HTMLButtonElement).disabled || control.getAttribute('aria-disabled') === 'true') return;
    const activeSurface = currentSurface() ?? surface;
    const match = classifyClickedControl(control, activeSurface);
    if (!match) return;
    noteUiAction(match.area, match.action, match.target, activeSurface);
  };
  docAny[UI_CLICK_KEY] = handler;
  document.addEventListener('click', handler, true);
}

/** Test-only cleanup/reset across module reloads on a shared JSDOM document. */
export function resetUiDelegationForTest(): void {
  delegated = false;
  if (typeof document === 'undefined') return;
  const docAny = document as unknown as Record<symbol, ((event: Event) => void) | undefined>;
  const prev = docAny[UI_CLICK_KEY];
  if (prev) {
    document.removeEventListener('click', prev, true);
    delete docAny[UI_CLICK_KEY];
  }
}
