import type { ViewColony } from '@terra/sim';
import {
  defineFeature,
  type Feature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import type { SendCommand } from '../../net/commandBus';
import type { Transport } from '../../net/types';
import {
  formatClock,
  formatRejectToast,
  MinimalHud,
  type MinimalHudOptions,
  type StoreLike,
} from './MinimalHud';
import './hud-min.css';

export { formatClock, formatRejectToast, MinimalHud, type MinimalHudOptions, type StoreLike };

declare module '../../core/registry/types' {
  interface GameView {
    tick?: number;
    colonies?: ViewColony[];
    blobs?: Record<string, unknown>;
  }
  interface FeatureServices {
    transport?: Pick<Transport, 'send' | 'onMessage'>;
    hudMin?: MinimalHud;
  }
}

export interface MountMinimalHudCtx {
  el?: HTMLElement;
  hudRoot?: HTMLElement;
  services?: FeatureContext['services'];
  sendCommand?: SendCommand;
  store?: StoreLike;
  transport?: Pick<Transport, 'onMessage'>;
  ownerColonyIndex?: number;
}

export interface MountedMinimalHud extends HudPanelInstance {
  readonly hud: MinimalHud;
  update(view: GameView): void;
  showToast(message: string, severity?: 'warning' | 'error' | 'info'): HTMLElement;
  checkOrSendPlaceBuilding(building: string, q: number, r: number): Promise<unknown>;
  dispose(): void;
}

export function mountMinimalHud(ctx: MountMinimalHudCtx): MountedMinimalHud {
  const hostEl = ctx.el ?? ctx.hudRoot ?? document.body;
  const hud = new MinimalHud(hostEl, {
    sendCommand: ctx.sendCommand ?? ctx.services?.sendCommand,
    store: ctx.store ?? ctx.services?.store,
    transport: ctx.transport ?? ctx.services?.transport,
    ownerColonyIndex: ctx.ownerColonyIndex,
    getOwnerColonyIndex: () => ctx.ownerColonyIndex ?? ctx.services?.landfall?.getOwnerColonyIndex(),
  });
  if (ctx.services && !ctx.services.hudMin) {
    ctx.services.hudMin = hud;
  }
  return {
    hud,
    update: (view) => hud.update(view),
    showToast: (msg, sev) => hud.showToast(msg, sev),
    checkOrSendPlaceBuilding: (b, q, r) => hud.checkOrSendPlaceBuilding(b, q, r),
    dispose: () => hud.dispose(),
  };
}

export const hudMinFeature: Feature & { mount(ctx: MountMinimalHudCtx): MountedMinimalHud } = {
  ...defineFeature({
    id: 'hud-min',
    wave: 'W01',
    hud: [
      {
        id: 'top-bar',
        slot: 'top-center',
        order: 0,
        mount(el, ctx) {
          return mountMinimalHud({ el, services: ctx.services });
        },
      },
    ],
  }),
  mount: mountMinimalHud,
};

export default hudMinFeature;
