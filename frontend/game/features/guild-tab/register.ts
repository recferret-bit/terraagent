import { formatRejectToast } from '../shared/rejectText';
import type { FeatureContext, HudPanelInstance } from '../../core/registry/types';
import { GuildOffers } from './GuildOffers';
import { GuildVisitModel } from './model';

/**
 * Adds the GUILD tab once the Trade Hub panel can take one. Hidden when W15 is off.
 * `services.guildTab` (set by the arrival toast) selects the tab and is then cleared.
 */
export function registerGuildTab(ctx: FeatureContext): HudPanelInstance {
  if (!ctx.flags.has('W15')) return { dispose() {} };
  const model = new GuildVisitModel();
  const stops: Array<() => void> = [];
  const store = ctx.services.store;
  if (store?.onGuildArrived) stops.push(store.onGuildArrived((p) => model.arrive(p)));
  if (store?.onGuildDeparted) stops.push(store.onGuildDeparted((p) => model.depart(p)));
  if (store?.onCommandRejected) {
    stops.push(store.onCommandRejected((r) => {
      if (r.kind === 'market.acceptGuildOffer') model.setReject(formatRejectToast(r.code, undefined, r.kind));
    }));
  }
  let unregister: (() => void) | null = null;
  let flag = ctx.services.guildTab === true;
  const openGuild = (): void => {
    if (!flag || !unregister || !ctx.services.showTradeHubTab) return;
    ctx.services.showTradeHubTab('guild');
    flag = false;
  };
  const tryRegister = (): void => {
    if (unregister || !ctx.services.registerTradeHubTab) return;
    unregister = ctx.services.registerTradeHubTab({
      id: 'guild',
      label: 'GUILD',
      mount: (el, c) => new GuildOffers(el, c, model),
    });
    openGuild();
  };
  Object.defineProperty(ctx.services, 'guildTab', {
    configurable: true,
    enumerable: true,
    get: () => flag,
    set: (v: boolean) => {
      flag = v === true;
      if (flag) openGuild();
    },
  });
  tryRegister();
  return {
    update() {
      tryRegister();
      openGuild();
    },
    dispose() {
      for (const stop of stops) stop();
      unregister?.();
      unregister = null;
      delete ctx.services.guildTab;
    },
  };
}
