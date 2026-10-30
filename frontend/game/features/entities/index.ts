import { defineFeature } from '../../core/registry/types';
import { EntityLayer } from './EntityLayer';
import '../../net/services';
import './services';

/** Draws sim entities in the 3D scene (needs `services.scene3d`, which only the online session provides). */
export default defineFeature({
  id: 'entities',
  wave: 'W00',
  renderers: [{
    id: 'entities',
    mount(ctx) {
      const s3 = ctx.services.scene3d;
      if (!s3) return { update() {}, dispose() {} };
      const layer = new EntityLayer(s3, (tiles) => ctx.services.netStats?.recordCorrection(tiles));
      return {
        update(view) { if (view.sim) layer.update(view.sim, performance.now()); },
        dispose: () => layer.dispose(),
      };
    },
  }],
});
