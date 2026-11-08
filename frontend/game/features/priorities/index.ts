import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { PrioritiesPanel } from '../shared/priorities/PrioritiesPanel';
import '../shared/priorities/priorities.css';

export { CANONICAL_PRIORITY_SLIDERS, PrioritySliders, type PrioritySlidersOptions, type SliderDef } from '../shared/priorities/PrioritySliders';
export { PrioritiesPanel } from '../shared/priorities/PrioritiesPanel';

declare module '../../core/registry/types' {
  interface FeatureServices {
    getPrioritiesPanel?: () => PrioritiesPanel | null;
  }
}

let activePanel: PrioritiesPanel | null = null;

export function isWaveOn(ctxOrFlags?: FeatureContext | ReadonlySet<string>, wave = 'W08'): boolean {
  if (!ctxOrFlags) return true;
  const flags = 'flags' in ctxOrFlags ? ctxOrFlags.flags : ctxOrFlags;
  if (!flags) return true;
  return flags.has(wave);
}

export function mountPrioritiesPanel(el: HTMLElement, ctx: FeatureContext): HudPanelInstance & { panel?: PrioritiesPanel } {
  if (!isWaveOn(ctx, 'W08')) {
    el.hidden = true;
    return {
      dispose() {},
    };
  }

  el.hidden = false;
  const panel = new PrioritiesPanel(el, ctx);
  activePanel = panel;
  ctx.services.getPrioritiesPanel = () => activePanel;

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
  id: 'priorities',
  wave: 'W08',
  // Mounted inside the HQ Goals / Priorities tabbed panel.
});
