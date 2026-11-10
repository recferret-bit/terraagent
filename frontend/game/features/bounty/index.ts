import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { BountyBoard } from './BountyBoard';
import './bounty.css';

function veilHost(el: HTMLElement): HTMLElement {
  return (el.closest('.ta-hud') as HTMLElement | null) ?? el.ownerDocument.body;
}

let board: BountyBoard | null = null;

function mountBoard(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  el.hidden = true;
  const panel = new BountyBoard(el, veilHost(el), ctx);
  board = panel;
  return {
    dispose() {
      if (board === panel) board = null;
      panel.dispose();
    },
  };
}

/** Planet menu → Bounties. Absent unless wave `W22` is on. Mounts after Council so the shared menu exists. */
export default defineFeature({
  id: 'bounty',
  wave: 'W22',
  hud: [{ id: 'bounties', slot: 'top-center', order: 4, mount: mountBoard }],
  menus: [
    {
      id: 'bounties',
      label: 'Bounties',
      open() {
        void board?.open();
      },
    },
  ],
});
