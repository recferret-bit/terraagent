import { readDirectorView } from '@terra/sim';
import { isProductionBuild } from '../../core/buildEnv';
import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { isReadOnlySpectator, ownColonyIndex, viewColony } from '../shared/colony';
import { DirectorPanel } from './DirectorPanel';
import { fetchAiAccess } from './parts/aiAccessApi';
import { directorDevCommands } from './devCommands';
import './director.css';

export { DirectorPanel } from './DirectorPanel';
export type { DirectorActionRow, DirectorAutopilotState } from './DirectorPanel';

declare module '../../core/registry/types' {
  interface FeatureServices {
    getDirectorPanel?: () => DirectorPanel | null;
  }
}

const AI_ACCESS_POLL_MS = 15_000;

/** W28-11: polls `ai-access` (every 15 s and after each director decision) while W28 is on and the host is the server. */
function mountAiAccessPoll(ctx: FeatureContext, panel: DirectorPanel): () => void {
  if (!ctx.flags.has('W28') || ctx.host === 'local' || isReadOnlySpectator(ctx.services)) return () => {};
  let live = true;
  const refresh = (): void => {
    const slot = {
      planetId: ctx.services.session?.planetId?.() ?? ctx.services.store?.currentPlanetId?.() ?? null,
      colonyIndex: ownColonyIndex(ctx.services),
    };
    void fetchAiAccess(panel.getActiveColonyId(), undefined, slot).then((b) => { if (live) panel.syncAiAccess(b); });
  };
  refresh();
  const timer = setInterval(refresh, AI_ACCESS_POLL_MS);
  const offStatus = ctx.services.store?.onDirectorStatus?.(refresh);
  return () => { live = false; clearInterval(timer); offStatus?.(); };
}

let activeDirectorPanel: DirectorPanel | null = null;

export default defineFeature({
  id: 'director',
  wave: 'W16',
  analytics: ['director.policy_changed'],
  hud: [{
    id: 'director-status',
    slot: 'top-right',
    order: 20,
    mount(el, ctx) {
      if (!ctx.flags.has('W16')) {
        el.hidden = true;
        return { dispose() {} };
      }
      el.hidden = false;
      const readOnly = isReadOnlySpectator(ctx.services);
      const panel = new DirectorPanel(el, {
        readOnly,
        onPolicyChange(patch) {
          if (isReadOnlySpectator(ctx.services)) return;
          const send = ctx.services.sendCommand ?? ctx.services.store?.sendCommand;
          if (send) void send('setDirectorPolicy', patch);
          ctx.services.track?.('director.policy_changed', {
            risk: patch.risk ?? 'conservative',
            preset: patch.preset ?? 'resources',
          });
        },
        onToggleAutopilot(enabled) {
          if (isReadOnlySpectator(ctx.services)) return;
          const send = ctx.services.sendCommand ?? ctx.services.store?.sendCommand;
          if (send) void send('setAiEnabled', { enabled });
        },
        onToggleWarDiplomacy(enabled) {
          if (isReadOnlySpectator(ctx.services)) return;
          const send = ctx.services.sendCommand ?? ctx.services.store?.sendCommand;
          if (send) void send('setAutopilot', { awayRaids: enabled });
        },
        onOpenHq() {
          document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-hq"]')?.click();
        },
        onOpenAway: ctx.flags.has('W09')
          ? () => {
              document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-away"]')?.click();
            }
          : undefined,
      });
      activeDirectorPanel = panel;
      ctx.services.getDirectorPanel = () => activeDirectorPanel;

      const sync = (view: unknown) => {
        if (!view) return;
        const idx = ownColonyIndex(ctx.services);
        const col = viewColony(view, idx);
        const colId = typeof col?.id === 'string' ? col.id : `col_${idx}`;
        const rec = readDirectorView(view, idx);
        panel.syncPolicy(rec, colId);
        panel.syncAutopilot({
          aiEnabled: col?.aiEnabled === true,
          warDiplomacy: rec?.awayRaids === true,
        });
      };
      if (ctx.services.store?.latest) sync(ctx.services.store.latest);
      const offView = ctx.services.store?.onView?.((v) => sync(v));
      let mountedLandfall = false;
      const offLandfall = ctx.services.landfall?.onChange?.(() => {
        if (mountedLandfall && ctx.services.store?.latest) sync(ctx.services.store.latest);
      });
      mountedLandfall = true;
      const aiAccess = mountAiAccessPoll(ctx, panel);

      return {
        update(view) {
          sync(view);
        },
        dispose() {
          offView?.();
          offLandfall?.();
          aiAccess();
          if (activeDirectorPanel === panel) activeDirectorPanel = null;
          panel.dispose();
        },
      };
    },
  }],
  devCommands: directorDevCommands(isProductionBuild() ? 'production' : 'development'),
});
