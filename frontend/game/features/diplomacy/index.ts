import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import { DiplomacyPanel, createDiplomacyPanel, type DiplomacyPanelInstance } from './DiplomacyPanel';
import {
  type DiplomacyColonyView,
  type DiplomacyPanelActions,
  type DiplomacyPanelOptions,
  type GameFeature,
  type TruceDurationHours,
  extractDiplomacyColonyView,
} from './types';
import './diplomacy.css';

export * from './types';
export { DiplomacyPanel, createDiplomacyPanel, type DiplomacyPanelInstance };

declare module '../../core/registry/types' {
  interface FeatureServices {
    getDiplomacyPanel?: () => DiplomacyPanelInstance | null;
  }
}

let activeDiplomacyPanel: DiplomacyPanelInstance | null = null;

function sendCommandToHost(ctx: FeatureContext, kind: string, args: unknown): void {
  const send = ctx.services.sendCommand ?? ctx.services.store?.sendCommand;
  if (send) void send(kind as any, args as any);
}

export function mountDiplomacyHud(
  el: HTMLElement,
  ctx: FeatureContext,
): HudPanelInstance & { panel?: DiplomacyPanelInstance } {
  if (!ctx.flags.has('W18')) {
    el.hidden = true;
    return {
      dispose() {},
    };
  }

  el.hidden = false;
  const actions: DiplomacyPanelActions = {
    onRespondTruce(offerId: string, accept: boolean) {
      sendCommandToHost(ctx, 'diplomacy.respondTruce', { offerId, accept });
    },
    onCancelTruce(truceId: string) {
      sendCommandToHost(ctx, 'diplomacy.cancelTruce', { truceId });
    },
    onProposeTruce(targetColonyId: string | number, hours: TruceDurationHours) {
      sendCommandToHost(ctx, 'diplomacy.proposeTruce', { targetColonyId, hours });
    },
  };

  const panel = createDiplomacyPanel(el, {
    actions,
    ownColonyIndex: ownColonyIndex(ctx.services),
  });

  activeDiplomacyPanel = panel;
  ctx.services.getDiplomacyPanel = () => activeDiplomacyPanel;

  if (ctx.services.store?.latest) {
    panel.update(ctx.services.store.latest);
  }

  const offView = ctx.services.store?.onView?.((v) => panel.update(v));
  const offEvents = ctx.services.store?.onServerEvents?.((evs) => panel.ingestSimEvents(evs));

  return {
    panel,
    update(view) {
      panel.update(view);
    },
    dispose() {
      offView?.();
      offEvents?.();
      if (activeDiplomacyPanel === panel) activeDiplomacyPanel = null;
      panel.dispose();
    },
  };
}

function handleDevOfferTruce(args: string[], ctx: FeatureContext): string {
  const fromColony = args[0] ? Number(args[0]) : 1;
  const hours = (args[1] ? Number(args[1]) : 6) as TruceDurationHours;
  const toColony = ownColonyIndex(ctx.services);
  sendCommandToHost(ctx, 'dev.offerTruce', { fromColony, toColony, durationHours: hours });
  return `Offered ${hours}h truce from colony #${fromColony} to colony #${toColony}`;
}

export const diplomacyFeature: GameFeature = defineFeature({
  id: 'diplomacy',
  wave: 'W18',
  hud: [
    {
      id: 'diplomacy-panel',
      slot: 'top-right',
      order: 22,
      mount: mountDiplomacyHud,
    },
  ],
  devCommands: [
    {
      name: 'offerTruce',
      help: 'offerTruce <colony> <hours> - Injects a truce offer from neighbor colony to player colony',
      run: handleDevOfferTruce,
    },
    {
      name: 'dev.offerTruce',
      help: 'dev.offerTruce <colony> <hours> - Injects a truce offer from neighbor colony to player colony',
      run: handleDevOfferTruce,
    },
  ],
});

export default diplomacyFeature;
