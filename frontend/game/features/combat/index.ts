import {
  defineFeature,
  type FeatureContext,
  type GameView,
  type HudPanelInstance,
} from '../../core/registry/types';
import {
  ALERT_PING_DURATION_MS,
  CombatAlertsHud,
  OFF_SCREEN_TILE_RADIUS,
  resolveScreenEdge,
  type CombatEventInput,
  type CombatLogEntry,
  type CombatLogEventKind,
  type PushUnderAttackPingOptions,
} from './CombatAlertsHud';
import {
  createThreatsMapLayer,
  drawThreatsLayer,
  isFaunaHiveKind,
  type CombatAlertPing,
  type ScreenEdge,
  type ThreatsDrawSummary,
} from './threatsLayer';
import './combat.css';

export {
  ALERT_PING_DURATION_MS,
  CombatAlertsHud,
  OFF_SCREEN_TILE_RADIUS,
  createThreatsMapLayer,
  drawThreatsLayer,
  isFaunaHiveKind,
  resolveScreenEdge,
  type CombatAlertPing,
  type CombatEventInput,
  type CombatLogEntry,
  type CombatLogEventKind,
  type PushUnderAttackPingOptions,
  type ScreenEdge,
  type ThreatsDrawSummary,
};

declare module '../../core/registry/types' {
  interface FeatureServices {
    combatAlerts?: CombatAlertsHud;
  }
  interface GameView {
    events?: ReadonlyArray<CombatEventInput>;
  }
}

export function mountCombatFeature(
  el: HTMLElement,
  ctx: FeatureContext,
  opts?: { now?: () => number },
): HudPanelInstance & { readonly hud: CombatAlertsHud; update(view: GameView): void } {
  const hud = new CombatAlertsHud(el, ctx, opts);
  ctx.services.combatAlerts = hud;
  return {
    hud,
    update(view) {
      hud.update(view);
    },
    dispose() {
      hud.dispose();
      if (ctx.services.combatAlerts === hud) {
        delete ctx.services.combatAlerts;
      }
    },
  };
}

export const combatFeature = defineFeature({
  id: 'combat',
  wave: 'W07',
  hud: [
    {
      id: 'combat-alerts',
      slot: 'top-right',
      order: 15,
      mount(el, ctx) {
        return mountCombatFeature(el, ctx);
      },
    },
  ],
});

export default combatFeature;
