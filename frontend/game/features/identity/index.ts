import { defineFeature } from '../../core/registry/types';
import { mountPilotChip } from './PilotChip';
import './identity.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /**
     * Guest session and social login (W06). `view().isGuest` stays true until `loginSocial` links a pilot.
     * The chip reads this; the online session supplies it.
     */
    pilot?: {
      view(): { isGuest: boolean; handle: string; accountId: string | null; accessToken: string };
      subscribe(fn: () => void): () => void;
      loginSocial(provider: 'google' | 'x', token: string): Promise<void>;
    };
  }
}

/** Guest-first pilot chip. Hidden when W06 is off and on `?host=local` (`hostOnly: 'server'`). */
export default defineFeature({
  id: 'identity',
  wave: 'W06',
  hostOnly: 'server',
  hud: [{ id: 'pilot', slot: 'top-left', order: 20, mount: mountPilotChip }],
});
