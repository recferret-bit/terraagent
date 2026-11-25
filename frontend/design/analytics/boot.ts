import { flush } from '../../game/core/analytics';
import {
  currentSurface, firstTouchBit, pathGroup, pingConsent,
  referrerClass, rememberSurface, runtimeLabel, type AnalyticsSurface, utmProps, viewportClass,
} from './context';
import { installClientErrorTracking } from './errors';
import { trackProduct } from './trackSafe';
import { installUiActionDelegation } from './ui';

let surfaceViewed = false;

/** Boots cookieless product analytics immediately (zero cookies, zero banner; honors GPC). */
export function bootProductAnalytics(surface: AnalyticsSurface): void {
  rememberSurface(surface);
  const consent = pingConsent();
  void postSurfacePing(surface, consent);
  installClientErrorTracking(surface);
  installUiActionDelegation(surface);
  if (consent === 'allow') {
    emitSurfaceViewed();
    void flush();
  }
}

export function emitSurfaceViewed(): void {
  if (surfaceViewed) return;
  const surface = currentSurface();
  if (!surface) return;
  surfaceViewed = true;
  const path = typeof location !== 'undefined' ? location.pathname : '/';
  trackProduct('surface_viewed', {
    surface,
    runtime: runtimeLabel(),
    viewport: viewportClass(),
    referrer_class: referrerClass(),
    path_group: pathGroup(path, surface),
    first_touch: firstTouchBit(),
    ...utmProps(),
  });
}

function postSurfacePing(surface: AnalyticsSurface, consent: 'allow' | 'decline' | 'unknown'): void {
  if (typeof fetch !== 'function') return;
  const body = JSON.stringify({ surface, consent });
  try {
    void fetch('/v1/analytics/surface', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch { /* analytics must not break the page */ }
}
