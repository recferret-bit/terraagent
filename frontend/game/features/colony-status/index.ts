import { defineFeature, type Feature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import {
  ColonyStatusHud,
  createColonyStatusHud,
  type ColonyStatusHudInstance,
} from './ColonyStatusHud';
import {
  type ColonyStatusHudOptions,
} from './types';
import './colony-status.css';

export * from './types';
export * from './ColonyStatusHud';

declare module '../../core/registry/types' {
  interface FeatureServices {
    getColonyStatusHud?: () => ColonyStatusHudInstance | null;
    startHubPlacement?: () => void;
  }
}

let activeColonyStatusHud: ColonyStatusHudInstance | null = null;

export function mountColonyStatusHud(
  el: HTMLElement,
  ctx: FeatureContext,
  options?: Partial<ColonyStatusHudOptions>,
): HudPanelInstance & { hud?: ColonyStatusHudInstance } {
  if (!ctx.flags.has('W18')) {
    el.hidden = true;
    return {
      dispose() {},
    };
  }

  el.hidden = false;
  const ownIndex = ownColonyIndex(ctx.services, options?.ownColonyIndex);
  const hud = createColonyStatusHud(el, ctx, {
    ...options,
    ownColonyIndex: ownIndex,
  });

  activeColonyStatusHud = hud;
  ctx.services.getColonyStatusHud = () => activeColonyStatusHud;

  if (ctx.services.store?.latest) {
    hud.update(ctx.services.store.latest);
  }

  const offView = ctx.services.store?.onView?.((v) => hud.update(v));
  const offEvents = ctx.services.store?.onServerEvents?.((evs) => hud.ingestSimEvents(evs));

  return {
    hud,
    update(view) {
      hud.update(view);
    },
    dispose() {
      offView?.();
      offEvents?.();
      if (activeColonyStatusHud === hud) {
        activeColonyStatusHud = null;
      }
      hud.dispose();
    },
  };
}

export const colonyStatusFeature: Feature = defineFeature({
  id: 'colony-status',
  wave: 'W18',
  hud: [
    {
      id: 'colony-status-hud',
      slot: 'top',
      order: 5,
      mount: mountColonyStatusHud,
    },
  ],
});

export default colonyStatusFeature;
