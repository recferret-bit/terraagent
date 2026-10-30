import { browserDeps } from './browser';
import { AnalyticsClient, type Props } from './client';

export { AnalyticsClient, ANALYTICS_ENDPOINT, BATCH_MAX, FLUSH_MS, type AnalyticsDeps, type Props } from './client';

let client: AnalyticsClient | undefined;
const get = (): AnalyticsClient => {
  if (!client) {
    client = new AnalyticsClient(browserDeps());
    addEventListener('pagehide', () => client?.onPageHide());
  }
  return client;
};

/** Records a funnel event. Does nothing (no network, no anonId) until the player allowed analytics. */
export const track = (name: string, props?: Props): void => get().track(name, props);
export const setConsent = (allowed: boolean): void => get().setConsent(allowed);
export const getConsent = (): boolean => get().getConsent();
export const flush = (): Promise<void> => get().flush();

export type TrackFn = typeof track;

declare module '../registry/types' {
  interface FeatureServices {
    /** Consent-gated product analytics (names a feature tracks are listed in `Feature.analytics`). */
    track: TrackFn;
  }
}

/** Dev helper: `window.__track.setConsent(true); __track.track('x'); await __track.flush()`. */
if (import.meta.env?.DEV) (window as unknown as { __track: unknown }).__track = { track, setConsent, getConsent, flush };
