import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { GoalsPanel } from './GoalsPanel';
import './goals.css';

export { GoalForm, type GoalFormOptions } from './GoalForm';
export { GoalsPanel, formatGoalLabel } from './GoalsPanel';

declare module '../../core/registry/types' {
  interface FeatureServices {
    getGoalsPanel?: () => GoalsPanel | null;
  }
}

let activePanel: GoalsPanel | null = null;

export function isWaveOn(ctxOrFlags?: FeatureContext | ReadonlySet<string>, wave = 'W08'): boolean {
  if (!ctxOrFlags) return true;
  const flags = 'flags' in ctxOrFlags ? ctxOrFlags.flags : ctxOrFlags;
  if (!flags) return true;
  return flags.has(wave);
}

export function mountGoalsPanel(el: HTMLElement, ctx: FeatureContext): HudPanelInstance & { panel?: GoalsPanel } {
  if (!isWaveOn(ctx, 'W08')) {
    el.hidden = true;
    return {
      dispose() {},
    };
  }

  el.hidden = false;
  const panel = new GoalsPanel(el, ctx);
  activePanel = panel;
  ctx.services.getGoalsPanel = () => activePanel;

  return {
    panel,
    update(view) {
      panel.update(view);
    },
    dispose() {
      if (activePanel === panel) activePanel = null;
      panel.dispose();
    },
  };
}

export default defineFeature({
  id: 'goals',
  wave: 'W08',
  hud: [
    {
      id: 'goals-panel',
      slot: 'top-right',
      order: 25,
      mount: mountGoalsPanel,
    },
  ],
});
