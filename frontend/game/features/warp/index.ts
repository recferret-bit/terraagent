import { defineFeature, type DevCommandDef } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import '../../net/services';
import './warp.css';

declare module '../../core/registry/types' {
  interface GameView {
    /** Dev time warp in effect (undefined/1 = none); set by the online flow from `welcome.warp` and `dev.warp`. */
    warp?: number;
  }
  interface FeatureServices {
    /** The session's planet (online flow); null before the first welcome. */
    session?: { planetId(): string | null };
  }
}

/** Badge text for a warp value, or null when no badge is shown (x1 / unknown). */
export const warpBadge = (k: number | undefined): string | null => (k !== undefined && k > 1 ? `×${k}` : null);

const warp: DevCommandDef = {
  name: 'warp',
  help: 'warp <k>  Server: time warp x1..x100 of this planet (warp 1 restores normal speed)',
  async run(a, ctx) {
    const k = Number(a[0]);
    if (a[0] === undefined || !Number.isInteger(k) || k < 1 || k > 100) throw new Error('usage: warp <k>  (integer 1..100)');
    const server = ctx.services.devServer;
    if (!server) throw new DevServerError('host_unavailable', 'warp needs the game server; not available on this host');
    const planetId = ctx.services.session?.planetId();
    if (!planetId) throw new Error('warp: not connected to a planet yet');
    await server('warp', { planetId, k });
    return k === 1 ? 'warp x1 (normal speed)' : `warp x${k} requested (the server caps it if the sim thread cannot keep up)`;
  },
};

/** `x10` badge beside the tick chip while the dev time warp is above 1, plus the `warp <k>` dev console command. */
export default defineFeature({
  id: 'warp',
  wave: 'W00',
  devCommands: [warp],
  hud: [{
    id: 'warp', slot: 'top-left', order: 1,
    mount(el) {
      const root = document.createElement('div');
      root.className = 'ta-warp plate-sm';
      root.dataset.testid = 'warp-badge';
      root.hidden = true;
      el.appendChild(root);
      return {
        update(view) {
          const text = warpBadge(view.warp);
          root.hidden = text === null;
          if (text !== null) root.textContent = text;
        },
        dispose: () => root.remove(),
      };
    },
  }],
});
