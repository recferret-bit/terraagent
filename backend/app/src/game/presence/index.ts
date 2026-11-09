import type { PrismaClient } from '@terra/db';
import { SystemPresenceClock } from './clock';
import { PrismaLastSeen } from './last-seen';
import { PresenceTracker, type PresenceTrackerDeps } from './tracker';
import { noopLastSeen, type PresenceCommandPort, type PresenceLog, type PresenceTransition } from './types';

export { ManualPresenceClock, SystemPresenceClock } from './clock';
export { PrismaLastSeen } from './last-seen';
export { PresenceTracker } from './tracker';
export { HardModeClock, type HardModeMark } from './hard-mode-clock';
export { noopLastSeen, type PresenceJoin, type PresenceLog } from './types';

/** Platform tracker. Pass `prisma` only when this process may write the dev/prod database. */
export function createPresenceTracker(opts: {
  commands: PresenceCommandPort;
  prisma?: PrismaClient;
  log?: PresenceLog;
  onTransition?: (info: PresenceTransition) => void | Promise<void>;
}): PresenceTracker {
  const deps: PresenceTrackerDeps = {
    clock: new SystemPresenceClock(),
    commands: opts.commands,
    lastSeen: opts.prisma ? new PrismaLastSeen(opts.prisma) : noopLastSeen,
    log: opts.log,
    onTransition: opts.onTransition,
  };
  return new PresenceTracker(deps);
}
