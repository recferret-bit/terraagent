import { CLOSE_CODES, type CloseCode } from '@terra/contracts';

/** A joined socket the table can close. `colonyId` is null for a dev or pre-home join. */
export interface PlayingSocket {
  playerId: string | undefined;
  colonyId: string | null;
  bye(code: CloseCode, reason: string): void;
}

/**
 * One playing socket per colony (CT-41).
 * Key is `colony:<colonyId>` when the join has one.
 * A join with no colony is `player:<playerId>` and replaces only another no-colony socket of that player.
 * `leaveRoom` clears `colonyId` before close, so the key is remembered on the socket, not re-read.
 */
export class PlayingSockets {
  private readonly byKey = new Map<string, PlayingSocket>();
  private readonly keyOf = new WeakMap<PlayingSocket, string>();

  /** Register `next` after its welcome. Closes the previous socket for that key with 4001. */
  replace(next: PlayingSocket): void {
    const key = playingKey(next);
    if (!key) return;
    this.dropStaleKey(next, key);
    const older = this.byKey.get(key);
    this.byKey.set(key, next);
    this.keyOf.set(next, key);
    if (older && older !== next) older.bye(CLOSE_CODES.replaced, 'replaced');
  }

  /** Drop `socket` if it is still the one registered under its join key. */
  forget(socket: PlayingSocket): void {
    const key = this.keyOf.get(socket);
    if (key && this.byKey.get(key) === socket) this.byKey.delete(key);
  }

  /** A socket that moves to another colony must not stay registered on the previous one. */
  private dropStaleKey(next: PlayingSocket, key: string): void {
    const prev = this.keyOf.get(next);
    if (prev && prev !== key && this.byKey.get(prev) === next) this.byKey.delete(prev);
  }
}

/** Colony when the join has one; otherwise the player, so two keys never close each other. */
export function playingKey(socket: Pick<PlayingSocket, 'playerId' | 'colonyId'>): string | undefined {
  if (socket.colonyId) return `colony:${socket.colonyId}`;
  if (socket.playerId) return `player:${socket.playerId}`;
  return undefined;
}
