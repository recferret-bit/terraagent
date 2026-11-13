import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { ActivePilotTracker } from './activePilot';
import { factCommand, profileCommand, xpCommand } from './devCommands';
import { AchievementToastHost } from './toast';
import './achievements.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    achievementToasts?: AchievementToastHost;
    activePilot?: ActivePilotTracker;
  }
}

function mountPilotTracking(_el: HTMLElement, ctx: FeatureContext) {
  const tracker = new ActivePilotTracker(ctx);
  ctx.services.activePilot = tracker;

  return {
    dispose() {
      if (ctx.services.activePilot === tracker) ctx.services.activePilot = undefined;
      tracker.dispose();

    },
  };
}

export default defineFeature({
  id: 'achievements',
  wave: 'W12',
  hostOnly: 'server',
  devCommands: [factCommand, xpCommand, profileCommand],
  hud: [
    {
      id: 'pilot-tracking',
      slot: 'top-left',
      order: 25,
      mount: mountPilotTracking,
    },
    {
      id: 'achievement-toast',
      slot: 'bottom-right',
      order: 70,
      mount(el, ctx) {
        const store = ctx.services.store as {
          onServerEvents?: (fn: (events: ReadonlyArray<{ kind: string; data?: Record<string, unknown> }>) => void) => () => void;
        } | undefined;
        const host = new AchievementToastHost(el, {
          onServerEvents: store?.onServerEvents ? (fn) => store.onServerEvents!(fn) : undefined,
          onOpenPlayer: () => ctx.services.openPilotDialog?.(true),
        });
        ctx.services.achievementToasts = host;
        return {
          dispose() {
            if (ctx.services.achievementToasts === host) ctx.services.achievementToasts = undefined;
            host.dispose();
          },
        };
      },
    },
  ],
});
