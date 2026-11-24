import { AWAY_AFTER_S, type SimCommandV1 } from '@terra/contracts';
import { createPlanet, snapshot, type PlanetState } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { ManualPresenceClock } from '../../src/game/presence/clock';
import { armRestoredPlanet, presentHumanColonies } from '../../src/game/presence/restored-away';
import { PresenceTracker } from '../../src/game/presence/tracker';
import type { LastSeenTouch } from '../../src/game/presence/types';

const AWAY_MS = AWAY_AFTER_S * 1000;

function rig() {
  const clock = new ManualPresenceClock();
  const posted: { planetId: string; cmd: SimCommandV1 }[] = [];
  const touched: LastSeenTouch[] = [];
  const tracker = new PresenceTracker({
    clock,
    commands: { submit: async (planetId, cmd) => { posted.push({ planetId, cmd }); return { ok: true }; } },
    lastSeen: { touch: async (input) => { touched.push(input); return {}; } },
  });
  const awayPosts = () => posted.map((p) => p.cmd.args as { colonyId: string; away: boolean });
  return { clock, tracker, touched, awayPosts };
}

const seated = (colonyId: string, colonyIndex: number) => ({ planetId: 'pl_dev', colonyId, playerId: `pr_${colonyId}`, colonyIndex });

describe('presence after a restart: restored seated humans are armed for away', () => {
  it('posts away for a colony whose player never reconnects, without stamping last_seen_at', async () => {
    const r = rig();
    expect(r.tracker.armSeated([seated('c1', 1), seated('c2', 2)])).toBe(2);
    r.clock.advance(AWAY_MS - 1);
    await r.tracker.settled();
    expect(r.awayPosts()).toEqual([]);
    r.clock.advance(1);
    await r.tracker.settled();
    expect(r.awayPosts()).toEqual([{ colonyId: 'c1', away: true }, { colonyId: 'c2', away: true }]);
    expect(r.touched).toEqual([]); // the player was not seen at boot
  });

  it('a player who reconnects within the window is never posted away; the others are', async () => {
    const r = rig();
    r.tracker.armSeated([seated('c1', 1), seated('c2', 2)]);
    r.clock.advance(10_000);
    r.tracker.join({ socketId: 's1', ...seated('c1', 1) });
    r.clock.advance(AWAY_MS);
    await r.tracker.settled();
    expect(r.awayPosts()).toEqual([{ colonyId: 'c2', away: true }]);
    // a later real disconnect of the reconnected player stamps last_seen as usual
    r.tracker.close('s1');
    r.clock.advance(AWAY_MS);
    await r.tracker.settled();
    expect(r.awayPosts().at(-1)).toEqual({ colonyId: 'c1', away: true });
    expect(r.touched.map((t) => t.colonyId)).toEqual(['c1']);
  });

  it('skips a colony that already has a socket on this process', () => {
    const r = rig();
    r.tracker.join({ socketId: 's1', ...seated('c1', 1) });
    expect(r.tracker.armSeated([seated('c1', 1)])).toBe(0);
  });
});

function stateWith(colonies: Record<string, unknown>[]): PlanetState {
  const s = createPlanet({ type: 'flat', seed: 'presence', planetId: 'pl_dev' });
  (s as unknown as { colonies: unknown[] }).colonies = colonies;
  return s;
}

describe('which restored colonies count as present humans (same rule as the AI sweep)', () => {
  const colonies = [
    { id: 'co_h', index: 0, playerId: 'pr_1', status: 'active' },
    { id: 'co_ai', index: 1, playerId: 'ai:iron', status: 'active' },
    { id: 'co_bot', index: 2, playerId: 'pr_bot', isBot: true, status: 'active' },
    { id: 'co_away', index: 3, playerId: 'pr_2', status: 'active', away: true },
    { id: 'co_dead', index: 4, playerId: 'pr_3', status: 'eliminated' },
  ];

  it('keeps seated, not-away, non-AI colonies', () => {
    expect(presentHumanColonies('pl_dev', stateWith(colonies))).toEqual([{ planetId: 'pl_dev', colonyId: 'co_h', playerId: 'pr_1', colonyIndex: 0 }]);
  });

  it('armRestoredPlanet reads the restored state and arms every tracker of the process', async () => {
    const bytes = snapshot(stateWith(colonies));
    const armed: string[][] = [];
    const tracker = { armSeated: (cs: readonly { colonyId: string }[]) => { armed.push(cs.map((c) => c.colonyId)); return cs.length; } };
    expect(await armRestoredPlanet({ fullState: async () => ({ bytes }) }, 'pl_dev', new Set([tracker]))).toBe(1);
    expect(armed).toEqual([['co_h']]);
  });
});
