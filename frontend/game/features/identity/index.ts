import { defineFeature, type FeatureContext, type HudPanelInstance } from '../../core/registry/types';
import type { TextClipboard } from './copyText';
import { formatPilotDisplayName, mountPilotChip } from './PilotChip';
import { PilotDialog } from './PilotDialog';
import './identity.css';

export { formatPilotDisplayName, mountPilotChip, PilotDialog };

declare module '../../core/registry/types' {
  interface FeatureServices {
    /**
     * Guest session and social login (W06). `view().isGuest` stays true until `loginSocial` links a pilot.
     * The chip reads this; the online session supplies it.
     */
    pilot?: {
      view(): { isGuest: boolean; handle: string; accountId: string | null; accessToken: string; saveEpoch?: number };
      subscribe(fn: () => void): () => void;
      loginSocial(
        provider: 'google' | 'x' | 'fastauth' | 'email' | 'near-wallet',
        token: string,
        options?: { readonly mode?: 'signin' | 'signup' },
      ): Promise<void>;
      logout?(): Promise<void>;
      /** Colony deposit poll. Absent in specs that only cover the guest chip. */
      watchRelay?(): {
        poll(): Promise<{ state: 'none' | 'pending' | 'settled' | 'failed'; opId?: string }>;
        retry(): Promise<{ state: 'pending' }>;
      };
    };
    /** When set, the pilot chip copies through this writer instead of `navigator.clipboard`. */
    clipboard?: TextClipboard;
    /** Optional override for identity adapter mode in tests (`mock` | `testnet` | `mainnet`). */
    identityMode?: 'mock' | 'testnet' | 'mainnet';
    /** Opens or closes the full-featured Pilot Profile dialog. */
    openPilotDialog?: (open?: boolean) => void;
  }
}

function mountIdentity(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  const dialog = new PilotDialog(el, ctx);
  ctx.services.openPilotDialog = (open = true) => dialog.setOpen(open);
  return {
    update: (view) => dialog.update(view),
    dispose() {
      if (ctx.services.openPilotDialog) delete ctx.services.openPilotDialog;
      dialog.dispose();
    },
  };
}

/** Guest-first pilot dialog & chip. Hidden when W06 is off and on `?host=local` (`hostOnly: 'server'`). */
export default defineFeature({
  id: 'identity',
  wave: 'W06',
  hostOnly: 'server',
  hud: [{ id: 'pilot', slot: 'top-left', order: 20, mount: mountIdentity }],
});
