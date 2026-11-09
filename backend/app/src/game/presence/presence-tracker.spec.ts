import { AWAY_AFTER_S, type SimCommandV1 } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { ManualPresenceClock } from './clock';
import { PresenceTracker } from './tracker';
import type { LastSeenPort, LastSeenTouch, PresenceCommandPort, PresenceJoin } from './types';

const AWAY_MS = AWAY_AFTER_S * 1000;

interface Posted {
  planetId: string;
  cmd: SimCommandV1;
}

function harness(opts?: { submit?: PresenceCommandPort['submit']; colonyIndex?: number }) {
  const clock = new ManualPresenceClock();
  const posted: Posted[] = [];
  const seen: LastSeenTouch[] = [];
  const commands: PresenceCommandPort = {
    submit:
      opts?.submit ??
      (async (planetId, cmd) => {
        posted.push({ planetId, cmd });
        return { ok: true };
      }),
  };
  const lastSeen: LastSeenPort = {
    async touch(input) {
      seen.push(input);
      return { colonyIndex: input.colonyIndex ?? opts?.colonyIndex };
    },
  };
  const tracker = new PresenceTracker({ clock, commands, lastSeen });
  const join = (socketId: string, colonyId = 'col_0', colonyIndex?: number): PresenceJoin => ({
    socketId,
    planetId: 'pl_dev',
    colonyId,
    playerId: 'pr_1',
    colonyIndex,
  });
  return { clock, posted, seen, tracker, join };
}

const awayOf = (posted: Posted[]) => posted.map((row) => (row.cmd.args as { away: boolean }).away);

describe('presence tracker', () => {
  it('pins AWAY_AFTER_S at 60', () => {
    expect(AWAY_AFTER_S).toBe(60);
  });

  it('reconnect after 30s posts nothing', async () => {
    const { clock, posted, seen, tracker, join } = harness();
    tracker.join(join('a'));
    tracker.close('a');
    clock.advance(30_000);
    tracker.join(join('b'));
    clock.advance(AWAY_MS);
    await tracker.settled();
    expect(posted).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('70s with no socket posts one away command and stamps last_seen once', async () => {
    const { clock, posted, seen, tracker, join } = harness();
    tracker.join(join('a', 'col_0', 2));
    tracker.close('a');
    clock.advance(70_000);
    await tracker.settled();
    expect(awayOf(posted)).toEqual([true]);
    expect(posted[0]?.cmd).toMatchObject({
      source: 'system',
      kind: 'system.presence',
      colonyIndex: 2,
      args: { colonyId: 'col_0', away: true },
    });
    expect(posted[0]?.planetId).toBe('pl_dev');
    expect(seen.map((row) => row.at.toISOString())).toEqual([new Date(AWAY_MS).toISOString()]);
  });

  it('fires at exactly 60s', async () => {
    const { clock, posted, tracker, join } = harness();
    tracker.join(join('a'));
    tracker.close('a');
    clock.advance(AWAY_MS);
    await tracker.settled();
    expect(awayOf(posted)).toEqual([true]);
  });

  it('a reconnect at exactly 60s is away, then back', async () => {
    const { clock, posted, tracker, join } = harness();
    tracker.join(join('a'));
    tracker.close('a');
    clock.nowMs = AWAY_MS;
    tracker.join(join('b'));
    await tracker.settled();
    expect(awayOf(posted)).toEqual([true, false]);
  });

  it('a reconnect 1ms early is a blip', async () => {
    const { clock, posted, tracker, join } = harness();
    tracker.join(join('a'));
    tracker.close('a');
    clock.nowMs = AWAY_MS - 1;
    tracker.join(join('b'));
    clock.advance(AWAY_MS);
    await tracker.settled();
    expect(posted).toEqual([]);
  });
});

describe('presence tracker edges', () => {
  it('duplicate timer fire posts one away command', async () => {
    const { clock, posted, tracker, join } = harness();
    tracker.join(join('a'));
    tracker.close('a');
    clock.fireSoonestTwice();
    await tracker.settled();
    expect(awayOf(posted)).toEqual([true]);
  });

  it('a second close while already away does not post again', async () => {
    const { clock, posted, tracker, join } = harness();
    tracker.join(join('a'));
    tracker.close('a');
    clock.advance(70_000);
    tracker.close('a');
    tracker.close('other');
    clock.advance(70_000);
    await tracker.settled();
    expect(awayOf(posted)).toEqual([true]);
  });

  it('a join that replaces the open socket cancels the away timer', async () => {
    const { clock, posted, tracker, join } = harness();
    tracker.join(join('old'));
    tracker.join(join('new'));
    tracker.close('old');
    clock.advance(70_000);
    await tracker.settled();
    expect(posted).toEqual([]);
  });

  it('coming back after away posts away:false', async () => {
    const { clock, posted, seen, tracker, join } = harness();
    tracker.join(join('a'));
    tracker.close('a');
    clock.advance(70_000);
    tracker.join(join('b'));
    await tracker.settled();
    expect(awayOf(posted)).toEqual([true, false]);
    expect(seen).toHaveLength(2);
    expect(posted[1]?.cmd.colonyIndex).toBeNull();
  });

  it('fills colonyIndex from last_seen when the socket did not know it', async () => {
    const { clock, posted, tracker, join } = harness({ colonyIndex: 4 });
    tracker.join(join('a'));
    tracker.close('a');
    clock.advance(AWAY_MS);
    await tracker.settled();
    expect(posted[0]?.cmd.colonyIndex).toBe(4);
  });

  it('keeps last_seen when the sim returns wave_disabled and does not throw', async () => {
    const { clock, posted, seen, tracker, join } = harness({
      submit: async (planetId, cmd) => {
        posted.push({ planetId, cmd });
        return { ok: false, code: 'wave_disabled' };
      },
    });
    tracker.join(join('a'));
    tracker.close('a');
    clock.advance(AWAY_MS);
    await expect(tracker.settled()).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(awayOf(posted)).toEqual([true]);
  });

  it('does not reject the socket path when submit throws', async () => {
    const warnings: string[] = [];
    const seen: LastSeenTouch[] = [];
    const clock = new ManualPresenceClock();
    const tracker = new PresenceTracker({
      clock,
      commands: {
        submit: async () => {
          throw new Error('thread_down');
        },
      },
      lastSeen: {
        async touch(input) {
          seen.push(input);
          return {};
        },
      },
      log: { warn: (obj) => warnings.push(String(obj.err)) },
    });
    tracker.join({ socketId: 'a', planetId: 'pl_dev', colonyId: 'col_0', playerId: 'pr_1' });
    tracker.close('a');
    clock.advance(AWAY_MS);
    await expect(tracker.settled()).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(warnings).toEqual(['thread_down']);
  });
});
