import { colonyPresence, type MemoryPresence } from '../../notify/presence';

/** One open colony socket. Pair with {@link releaseColonySocket}. W09-02 replaces this writer. */
export function holdColonySocket(colonyId: string, presence: MemoryPresence = colonyPresence): void {
  presence.connect(colonyId);
}

/** Drops one hold. A release when none are held does nothing. */
export function releaseColonySocket(colonyId: string, presence: MemoryPresence = colonyPresence): void {
  presence.disconnect(colonyId);
}
