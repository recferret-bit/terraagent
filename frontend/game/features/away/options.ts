import type { DirectorKeyStatusPayload } from '@terra/contracts';
import type { CommandSink } from '../shared/commandDispatch';

/** Channels the away plate and its autoTrade section share. */
export interface AwayPanelOptions {
  sendCommand?: CommandSink['sendCommand'];
  store?: CommandSink['store'];
  /** `W15` shows autoTrade. `W18` adds the `truce` partner (the sim rejects it otherwise). */
  flags?: ReadonlySet<string>;
  colonyId?: () => string | null;
  accessToken?: () => string | null;
  fetchImpl?: typeof fetch;
  /** `director.status` pushes. The same payload as POST and DELETE `/v1/near/director-key`. */
  subscribeDirector?: (fn: (payload: DirectorKeyStatusPayload) => void) => () => void;
}
