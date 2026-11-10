import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { CouncilPanel } from './CouncilPanel';
import { TREASURY_DEV_COMMANDS } from './devCommands';
import { EffectHud } from './EffectHud';
import './council.css';
import './treasury.css';

function veilHost(el: HTMLElement): HTMLElement {
  return (el.closest('.ta-hud') as HTMLElement | null) ?? el.ownerDocument.body;
}

let council: CouncilPanel | null = null;

function mountEffects(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  const hud = new EffectHud(el, veilHost(el));
  const w22 = ctx.flags.has('W22');
  return {
    update(view) {
      hud.update({ tick: typeof view.tick === 'number' ? view.tick : Number.NaN, treasury: view.blobs?.treasury, w22 });
    },
    dispose() {
      hud.dispose();
    },
  };
}

function mountCouncil(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  const panel = new CouncilPanel(el, veilHost(el), ctx);
  council = panel;
  return {
    update(view) {
      panel.update(view);
    },
    dispose() {
      if (council === panel) council = null;
      panel.dispose();
    },
  };
}

/** Planet-wide effect badges and the Planet menu → Council. Absent unless wave `W22` is on. */
export default defineFeature({
  id: 'treasury',
  wave: 'W22',
  hud: [
    { id: 'effect-badges', slot: 'top-center', order: 2, mount: mountEffects },
    { id: 'council', slot: 'top-center', order: 3, mount: mountCouncil },
  ],
  menus: [
    {
      id: 'council',
      label: 'Council',
      open() {
        void council?.open();
      },
    },
  ],
  devCommands: [...TREASURY_DEV_COMMANDS],
});
