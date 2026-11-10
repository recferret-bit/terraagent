import { defineFeature } from '../../core/registry/types';
import { GuildShipView } from './GuildShipView';

export { dockSpotFromView, pickBusiestDock, GUILD_DOCK_FALLBACK } from './dockSpot';
export { GuildShipPresenter, GUILD_TRANSIT_MS, GUILD_CRUISE_M } from './GuildShipPresenter';
export type { GuildDockMark, GuildShipPhase, GuildShipPose } from './GuildShipPresenter';
export { GuildShipView } from './GuildShipView';

/** Guild ship descent / dock / departure. The Trade Hub tab is `features/guild-tab` (W15-17). */
export default defineFeature({
  id: 'guild',
  wave: 'W15',
  renderers: [{ id: 'guild-ship', mount: (ctx) => new GuildShipView(ctx) }],
});
