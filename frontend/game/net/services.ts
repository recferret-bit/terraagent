import type { SendCommand } from './commandBus';
import type { DevServer, LedgerQuery } from './devServer';
import type { NetStatsBoard, NetStatsView } from './netStats';

declare module '../core/registry/types' {
  interface FeatureServices {
    /** Sim command over the transport (online session: `CommandBus.send`). Absent or `notConnectedSend` where there is no server. */
    sendCommand?: SendCommand;
    /** Server dev command (`/v1/dev/commands/:name`); replaced on the local host. */
    devServer?: DevServer;
    /** The host's resource ledger of one account (dev console `ledger`): server dev route, or the browser host's in-memory one. */
    ledgerQuery?: LedgerQuery;
    /** The joined planet of this session (`null` before the welcome). Provided by the online session. */
    session?: { planetId(): string | null; colonyId?(): string | null };
    /** Dev overlay counters (online session). */
    netStats?: NetStatsBoard;
  }
  interface GameView {
    /** Prediction / correction numbers for the dev overlay. */
    net?: NetStatsView;
  }
}
