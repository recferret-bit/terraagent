import { CLOSE_CODES, type CloseCode } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { playingKey, PlayingSockets, type PlayingSocket } from '../../src/ws/playing-sockets';

/** A socket with no colonyId replaces only another no-colony socket of the same player. It never closes a socket that has a colony id, and a colony join does not close it. */
function socket(playerId: string, colonyId: string | null): PlayingSocket & { open: boolean; code?: number; reason?: string } {
  const s = {
    playerId,
    colonyId,
    open: true,
    code: undefined as number | undefined,
    reason: undefined as string | undefined,
    bye(code: CloseCode, reason: string) {
      s.open = false;
      s.code = code;
      s.reason = reason;
    },
  };
  return s;
}

describe('one playing socket per colony', () => {
  it('two joins of the same colony close the first with the replaced code', () => {
    const table = new PlayingSockets();
    const first = socket('p', 'co_a');
    const second = socket('p', 'co_a');
    table.replace(first);
    table.replace(second);
    expect(first.open).toBe(false);
    expect(first.code).toBe(CLOSE_CODES.replaced);
    expect(first.reason).toBe('replaced');
    expect(second.open).toBe(true);
    expect(playingKey(second)).toBe('colony:co_a');
  });

  it('two joins of different colonies leave the first open', () => {
    const table = new PlayingSockets();
    const first = socket('p', 'co_a');
    const second = socket('p', 'co_b');
    table.replace(first);
    table.replace(second);
    expect(first.open).toBe(true);
    expect(second.open).toBe(true);
  });

  it('the same socket joining twice does not close itself', () => {
    const table = new PlayingSockets();
    const same = socket('p', 'co_a');
    table.replace(same);
    table.replace(same);
    expect(same.open).toBe(true);
    expect(same.code).toBeUndefined();
  });

  it('a socket with no colonyId replaces only another no-colony socket of the same player, never one that has a colony id', () => {
    expect(playingKey({ playerId: 'p', colonyId: null })).toBe('player:p');
    const table = new PlayingSockets();
    const lobby = socket('p', null);
    const colony = socket('p', 'co_a');
    table.replace(lobby);
    table.replace(colony);
    expect(lobby.open).toBe(true);
    const otherLobby = socket('p', null);
    table.replace(otherLobby);
    expect(lobby.code).toBe(CLOSE_CODES.replaced);
    expect(colony.open).toBe(true);
    expect(otherLobby.open).toBe(true);
  });

  it('forgetting the replaced socket, after its colony id is cleared, keeps the new one', () => {
    const table = new PlayingSockets();
    const first = socket('p', 'co_a');
    const second = socket('p', 'co_a');
    table.replace(first);
    table.replace(second);
    first.colonyId = null;
    table.forget(first);
    const third = socket('p', 'co_a');
    table.replace(third);
    expect(second.code).toBe(CLOSE_CODES.replaced);
    expect(third.open).toBe(true);
  });

  it('a socket that joins a second colony does not stay registered on the first', () => {
    const table = new PlayingSockets();
    const same = socket('p', 'co_a');
    table.replace(same);
    same.colonyId = 'co_b';
    table.replace(same);
    expect(same.open).toBe(true);
    const back = socket('q', 'co_a');
    table.replace(back);
    expect(same.open).toBe(true);
    expect(back.open).toBe(true);
  });
});
