import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { GuildToastHost } from './toast';
import './guild-toast.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** W15-17 reads this: set true when the arrival toast is tapped (Trade Hub opens; no Guild tab yet). */
    guildTab?: boolean;
  }
}

function openTradeHub(ctx: FeatureContext): void {
  ctx.services.openTradeHubPanel?.(true);
  ctx.services.guildTab = true;
}

function watchGuild(ctx: FeatureContext, host: GuildToastHost): () => void {
  const store = ctx.services.store;
  const offArrived = store?.onGuildArrived?.((payload) => host.arrive(payload)) ?? (() => {});
  const offDeparted = store?.onGuildDeparted?.((payload) => host.depart(payload)) ?? (() => {});
  return () => {
    offArrived();
    offDeparted();
  };
}

/** Arrival and departure toasts. Absent from the registry unless wave `W15` is on; a mount with the flag off ignores pushes. */
export default defineFeature({
  id: 'guild-toast',
  wave: 'W15',
  hud: [
    {
      id: 'guild-toast',
      slot: 'top-center',
      order: 40,
      mount(el, ctx) {
        el.hidden = true;
        const host = new GuildToastHost(ctx.services.hudOverlay ?? el, {
          enabled: () => ctx.flags.has('W15'),
          openTrade: () => openTradeHub(ctx),
        });
        const off = watchGuild(ctx, host);
        return {
          dispose() {
            off();
            host.dispose();
          },
        };
      },
    },
  ],
});
