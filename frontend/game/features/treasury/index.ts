import { defineFeature } from '../../core/registry/types';
import { EffectHud } from './EffectHud';
import './treasury.css';

function veilHost(el: HTMLElement): HTMLElement {
  return (el.closest('.ta-hud') as HTMLElement | null) ?? el.ownerDocument.body;
}

/** Planet-wide effect badges. Absent unless wave `W22` is on (`selectFeatures` drops the feature). */
export default defineFeature({
  id: 'treasury',
  wave: 'W22',
  hud: [{
    id: 'effect-badges',
    slot: 'top-center',
    order: 2,
    mount(el, ctx) {
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
    },
  }],
});
