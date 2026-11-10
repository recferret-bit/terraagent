import { defineFeature, type DevCommandDef, type GameView } from '../../core/registry/types';

declare module '../../core/registry/types' {
  interface GameView {
    /** Server tick of the newest replica view (set by the online flow from `WorldStore`). */
    tick?: number;
  }
}

/** Newest tick seen by the `tick-tracker` renderer (one per mounted session), or null before the first view. */
let latestTick: number | null = null;

/** Records the newest view's tick; the HUD no longer shows a tick chip (use the `tick` console command). */
export function trackTick(view: GameView): void {
  if (typeof view.tick === 'number' && view.tick >= 0) latestTick = view.tick;
}

export const tickCommand: DevCommandDef = {
  name: 'tick',
  help: 'tick  Current server tick of the newest replica view',
  run(_args, ctx) {
    const t = ctx.services.store?.latest?.tick ?? latestTick;
    if (typeof t !== 'number' || t < 0) return 'tick: no view yet';
    return `tick ${t}`;
  },
};

/** `tick` console command (replaces the old `TICK n` HUD chip). */
export default defineFeature({
  id: 'tick',
  wave: 'W00',
  renderers: [{
    id: 'tick-tracker',
    mount() {
      latestTick = null;
      return { update: (view) => trackTick(view), dispose: () => { latestTick = null; } };
    },
  }],
  devCommands: [tickCommand],
});
