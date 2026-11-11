import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import { ChainStatusModal } from './ChainStatusModal';
import './chain-status.css';

export { ChainStatusModal, type NearPortEntry, type NearStatusResponse } from './ChainStatusModal';

let activeModal: ChainStatusModal | null = null;

function mountChainStatusHook(_el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  const modal = new ChainStatusModal(ctx);
  activeModal = modal;
  return {
    dispose() {
      modal.close();
      if (activeModal === modal) activeModal = null;
    },
  };
}

/** Chain Status modal (`W23-02`, `W23-43`): 11-port NEAR adapter matrix, NearBlocks links, and live 1Click dry quote. */
export default defineFeature({
  id: 'chain-status',
  wave: 'W06',
  hostOnly: 'server',
  hud: [{ id: 'chain-status-hook', slot: 'top-right', order: 95, mount: mountChainStatusHook }],
  menus: [
    {
      id: 'chain-status',
      label: 'Chain status',
      open(ctx: FeatureContext) {
        if (!activeModal) activeModal = new ChainStatusModal(ctx);
        activeModal.open();
      },
    },
  ],
});
