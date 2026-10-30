import { defineFeature } from '../../core/registry/types';
import { ConstructionMenu } from './ConstructionMenu';
import type { BuildingKind } from './catalog';
import './construction-menu.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Request placing a building ghost of the given kind. */
    startPlacement?: (building: BuildingKind) => void;
  }

  interface GameView {
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
