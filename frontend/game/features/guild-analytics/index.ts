import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { GuildAnalytics, GUILD_ANALYTICS_EVENTS } from './tracker';

export { GuildAnalytics, GUILD_ANALYTICS_EVENTS } from './tracker';
export type { GuildAnalyticsEvent, GuildDock, ServerEventLike, TrackLike } from './tracker';

/** Subscribes while W15 is on. A mount with the flag off records nothing. */
function listen(ctx: FeatureContext): () => void {
  if (!ctx.flags.has('W15')) return () => {};
  const analytics = new GuildAnalytics(ctx.services.track, () => ctx.flags.has('W15'));
  const store = ctx.services.store;
  const offDock = store?.onGuildArrived?.((payload) => analytics.docked(payload)) ?? (() => {});
  const offEvents = store?.onServerEvents?.((events) => analytics.onServerEvents(events)) ?? (() => {});
  return () => {
    offDock();
    offEvents();
  };
}

/** Guild and director funnel events. Absent from the registry unless wave `W15` is on. */
export default defineFeature({
  id: 'guild-analytics',
  wave: 'W15',
  analytics: [...GUILD_ANALYTICS_EVENTS],
  hud: [{
    id: 'guild-analytics',
    slot: 'top-center',
    order: 41,
    mount(el, ctx) {
      el.hidden = true;
      const stop = listen(ctx);
      return { dispose: stop };
    },
  }],
});
