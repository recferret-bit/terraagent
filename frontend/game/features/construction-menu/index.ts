import { defineFeature } from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { ConstructionMenu } from './ConstructionMenu';
import { evaluatePlacementGhost, PlacementGhostController, type PlacementGhostState, type PlacementGhostTile } from './PlacementGhost';
import type { BuildingKind } from './catalog';
import './construction-menu.css';

export { ConstructionMenu, evaluatePlacementGhost, PlacementGhostController };
export type { PlacementGhostState, PlacementGhostTile };

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Request placing a building ghost of the given kind. */
    startPlacement?: (building: BuildingKind | string) => void;
    setHoverTile?: (q: number, r: number) => void;
    rotate?: () => void;
    confirm?: () => boolean;
    cancel?: () => void;
    getGhostState?: () => PlacementGhostState | null;

    setPlacementHoverTile?: (q: number, r: number) => void;
    rotatePlacement?: () => void;
    confirmPlacement?: () => boolean;
    cancelPlacement?: () => void;
    getPlacementGhostState?: () => PlacementGhostState | null;
  }

  interface GameView {
    /** Planet parameters. */
    planet?: { id?: string; type?: unknown; radius?: number };
    /** Client tiles buffer. */
    tiles?: ClientTiles;
    /** Entity data buffer (count * ENTITY_STRIDE floats) or entity records. */
    entities?: Float32Array | Array<{ kind?: number; [key: string]: unknown }>;
    /** Colony status list. */
    colonies?: Array<{
      hubBuilt?: boolean;
      stage?: number;
      stock?: Record<string, number>;
      [key: string]: unknown;
    }>;
    /** Shorthand for colony 0 hubBuilt. */
    hubBuilt?: boolean;
    /** Shorthand for colony 0 stock. */
    stock?: Record<string, number>;
  }
}

let activeMenu: ConstructionMenu | null = null;


export default defineFeature({
  id: 'construction-menu',
  wave: 'W02',
  hud: [
    {
      id: 'construction-menu',
      slot: 'bottom-left',
      order: 10,
      mount(el, ctx) {
        const menu = new ConstructionMenu(el, ctx);
        activeMenu = menu;
        return {
          update(view) {
            menu.update(view);
          },
          dispose() {
            if (activeMenu === menu) activeMenu = null;
            menu.dispose();
          },
        };
      },
    },
  ],
  menus: [
    {
      id: 'construction',
      label: 'Build',
      open() {
        activeMenu?.setOpen(true);
      },
    },
  ],
});
