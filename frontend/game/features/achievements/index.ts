import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { ActivePilotTracker } from './activePilot';
import { AchievementToastHost } from './toast';
import './achievements.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    achievementToasts?: AchievementToastHost;
    activePilot?: ActivePilotTracker;
  }
}

function mountMeChip(el: HTMLElement, ctx: FeatureContext) {
  const tracker = new ActivePilotTracker(ctx);
  ctx.services.activePilot = tracker;

  const chip = document.createElement('div');
  chip.className = 'plate-sm ta-me-chip';
  const link = document.createElement('a');
  link.className = 'ta-me-link';
  link.dataset.testid = 'hud-me-link';
  link.href = '/me.html';
  link.textContent = 'PILOT / ME';
  chip.appendChild(link);
  el.appendChild(chip);

  return {
    dispose() {
      if (ctx.services.activePilot === tracker) ctx.services.activePilot = undefined;
      tracker.dispose();
      chip.remove();
    },
  };
}

export default defineFeature({
  id: 'achievements',
  wave: 'W12',
  hostOnly: 'server',
  hud: [
    {
      id: 'me-link',
      slot: 'top-left',
      order: 25,
      mount: mountMeChip,
    },
    {
      id: 'achievement-toast',
      slot: 'bottom-right',
      order: 70,
      mount(el, ctx) {
        const store = ctx.services.store as { onServerEvents?: never } | undefined;
        const host = new AchievementToastHost(el, store);
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
