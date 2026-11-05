import type { FeatureContext, HudPanelDef, MenuDef } from '../../../core/registry/types';
import { BoardController, httpSnapshot } from './BoardController';
import { BoardPanel } from './BoardPanel';
import './board.css';

declare module '../../../core/registry/types' {
  interface FeatureServices {
    /** W13-23: the price board panel; `setOpen(true)` opens it. */
    priceBoard?: BoardPanel;
  }
}

let active: BoardPanel | undefined;

/** HUD panel of the price board (W13-23), hidden until the "Price board" menu entry opens it. */
export const boardHud: HudPanelDef = {
  id: 'price-board',
  slot: 'bottom-left',
  order: 62,
  mount(el: HTMLElement, ctx: FeatureContext) {
    const s = ctx.services;
    const controller = new BoardController(httpSnapshot(), () => s.session?.planetId() ?? null, s.transport as never);
    const panel = new BoardPanel(el, controller);
    s.priceBoard = panel;
    active = panel;
    return {
      dispose() {
        if (s.priceBoard === panel) s.priceBoard = undefined;
        if (active === panel) active = undefined;
        controller.dispose();
        panel.dispose();
      },
    };
  },
};

export const boardMenu: MenuDef = { id: 'price-board', label: 'Price board', open() { active?.setOpen(true); } };
