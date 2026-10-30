import { defineFeature } from '../../core/registry/types';
import { UnitsMenu } from './UnitsMenu';
import './units-menu.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Sim enqueue task command over the transport or local host. */
    enqueueHubUnit?: (opts: {
      unit?: 'harvester';
      count?: number;
      repeat?: boolean;
      colonyIndex?: number;
      [key: string]: unknown;
    }) => void;
  }

  interface GameView {
    unitQueue?: Array<unknown>;
    supply?: {
      used: number;
      cap: number;
      [key: string]: unknown;
    };
  }
}

let activeMenu: UnitsMenu | null = null;

export default defineFeature({
  id: 'units-menu',
  wave: 'W02',
  hud: [
    {
      id: 'units-menu',
      slot: 'bottom-left',
      order: 20,
      mount(el, ctx) {
        const menu = new UnitsMenu(el, ctx);
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
      id: 'units',
      label: 'Units',
      open() {
        activeMenu?.setOpen(true);
      },
    },
  ],
});
