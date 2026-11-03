import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import {
  extractStageReachedData,
  formatItemList,
  formatItemLabel,
  StageToast,
  type StageToastOptions,
} from './StageToast';
import { StageTrackHud } from './StageTrackHud';
import './stages.css';

export {
  extractStageReachedData,
  formatItemList,
  formatItemLabel,
  StageToast,
  type StageToastOptions,
};
export { extractDwellRemainingSeconds, formatDwellCountdown, StageTrackHud } from './StageTrackHud';

declare module '../../core/registry/types' {
  interface FeatureServices {
    getStageTrackHud?: () => StageTrackHud | null;
    showStageToast?: (stage: number, opts?: StageToastOptions) => HTMLElement | null;
  }
}

let activeHud: StageTrackHud | null = null;

export function showStageToast(stage: number, opts?: StageToastOptions): HTMLElement | null {
  return activeHud?.showStageToast(stage, opts) ?? null;
}

export function isWaveOn(ctxOrFlags?: FeatureContext | ReadonlySet<string>, wave = 'W08'): boolean {
  if (!ctxOrFlags) return true;
  const flags = 'flags' in ctxOrFlags ? ctxOrFlags.flags : ctxOrFlags;
  if (!flags) return true;
  return flags.has(wave);
}

export function mountStageTrackHud(el: HTMLElement, ctx: FeatureContext): HudPanelInstance & { hud?: StageTrackHud } {
  if (!isWaveOn(ctx, 'W08')) {
    el.hidden = true;
    return {
      dispose() {},
    };
  }

  el.hidden = false;
  const hud = new StageTrackHud(el, ctx);
  activeHud = hud;
  if (ctx.services) {
    ctx.services.getStageTrackHud = () => activeHud;
    ctx.services.showStageToast = (stage, opts) => activeHud?.showStageToast(stage, opts) ?? null;
  }

  return {
    hud,
    update(view) {
      hud.update(view);
    },
    dispose() {
      if (activeHud === hud) activeHud = null;
      hud.dispose();
    },
  };
}

export default defineFeature({
  id: 'stages',
  wave: 'W08',
  hud: [
    {
      id: 'stage-track-hud',
      slot: 'top-left',
      order: 15,
      mount: mountStageTrackHud,
    },
  ],
});
