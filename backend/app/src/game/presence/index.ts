import type { PrismaClient } from '@terra/db';
import { SystemPresenceClock } from './clock';
import { PrismaPlanetActivity } from '../lifecycle/planet-activity.store';
import { PrismaLastSeen } from './last-seen';
import { PlanetSeenWriter } from './planet-seen';
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
  const clock = new SystemPresenceClock();
  const deps: PresenceTrackerDeps = {
    clock,
    commands: opts.commands,
    lastSeen: opts.prisma ? new PrismaLastSeen(opts.prisma) : noopLastSeen,
    log: opts.log,
    onTransition: opts.onTransition,
    ...(opts.prisma ? { planetSeen: new PlanetSeenWriter(new PrismaPlanetActivity(opts.prisma), clock, opts.log) } : {}),
  };
  return new PresenceTracker(deps);
}
