import type { SendCommand } from './commandBus';
import type { DevServer } from './devServer';
import type { NetStatsBoard, NetStatsView } from './netStats';

declare module '../core/registry/types' {
  interface FeatureServices {
    /** Sim command over the transport (online session: `CommandBus.send`). Absent or `notConnectedSend` where there is no server. */
    sendCommand?: SendCommand;
    /** Server dev command (`/v1/dev/commands/:name`); replaced on the local host. */
    devServer?: DevServer;
    /** Dev overlay counters (online session). */
    netStats?: NetStatsBoard;
  }
  interface GameView {
    /** Prediction / correction numbers for the dev overlay. */
    net?: NetStatsView;
  }
}
