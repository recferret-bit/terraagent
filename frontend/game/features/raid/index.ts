import {
  defineFeature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import { createPvpTracker, type PvpTracker } from './pvpTracker';
import { RaidTargetPicker, type RaidTargetPickerOptions } from './RaidTargetPicker';

export * from './pvpTracker';
export * from './raidTargets';
export * from './RaidTargetPicker';

export const createPvpAnalyticsTracker = createPvpTracker;

export function mountRaidFeature(
  el: HTMLElement,
  ctx: FeatureContext,
  opts?: Partial<RaidTargetPickerOptions>,
): HudPanelInstance & {
  readonly picker?: RaidTargetPicker;
  readonly tracker?: PvpTracker;
  update(view: GameView): void;
} {
  if (!ctx.flags.has('W18')) {
    el.hidden = true;
    return {
      update() {},
      dispose() {},
    };
  }

  el.hidden = false;
  const tracker = createPvpTracker(ctx.services.track);
  const ownColId = String(ctx.services.colonyId ?? 'col_0');
  const rawPlanet = (ctx.services.store as any)?.currentPlanetId;
  const planetId =
    typeof (ctx.services as any).session?.planetId === 'function'
      ? (ctx.services as any).session.planetId()
      : typeof rawPlanet === 'function'
        ? rawPlanet()
        : typeof rawPlanet === 'string'
          ? rawPlanet
          : undefined;

  const offEvents = ctx.services.store?.onServerEvents?.((events) => {
    for (const ev of events) {
      tracker.handleSimEvent(ev, ownColId, planetId);
    }
  });

  const picker = new RaidTargetPicker(el, {
    sendCommand(kind, args) {
      const send = ctx.services.sendCommand ?? ctx.services.store?.sendCommand;
      if (send) void send(kind as any, args as any);
    },
    ownColonyIndex: ownColonyIndex(ctx.services),
    getOwnColonyIndex: () => ownColonyIndex(ctx.services),
    initialView: ctx.services.store?.latest,
    ...opts,
  });

  const offView = ctx.services.store?.onView?.((v) => picker.update(v));

  return {
    picker,
    tracker,
    update(v) {
      picker.update(v);
    },
    dispose() {
      offEvents?.();
      offView?.();
      picker.dispose();
    },
  };
}

export const raidFeature = defineFeature({
  id: 'raid',
  label: 'Raid Colony',
  wave: 'W18',
  slot: 'bottom-right',
  mount(el: HTMLElement, ctx: FeatureContext) {
    return mountRaidFeature(el, ctx);
  },
  hud: [
    {
      id: 'raid-target-picker',
      slot: 'bottom-right',
      order: 25,
      mount(el: HTMLElement, ctx: FeatureContext) {
        return mountRaidFeature(el, ctx);
      },
    },
  ],
} as any);

export default raidFeature;
