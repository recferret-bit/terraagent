import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { directorDebounceMs, projectTriggers, type TriggerEvent } from '../../src/ai/triggers/project';

function world(over: Partial<TriggerEvent> & Pick<TriggerEvent, 'trigger' | 'atMs'>): TriggerEvent {
  return { colonyId: 'colony-1', critical: false, source: 'world', ...over };
}

describe('W16-05 burst coalescing', () => {
  it('keeps one shortage from a 1s burst and suppresses the director echo', () => {
    const burst = Array.from({ length: 10 }, (_, i) => world({ trigger: 'resource.shortage', atMs: i * 100 }));
    const echo = world({ trigger: 'resource.shortage', atMs: 1_000, source: 'director', critical: true });
    const { kept, coalesced, suppressed } = projectTriggers([...burst, echo], 60_000);
    expect(kept).toHaveLength(1);
    expect(coalesced).toBe(9);
    expect(suppressed).toBe(1);
    expect(kept[0]).toEqual(burst[0]);
    expect(kept.some((event) => event.source === 'director')).toBe(false);
  });

  it('does not coalesce a different colony or trigger', () => {
    const { kept, coalesced } = projectTriggers([
      world({ trigger: 'resource.shortage', atMs: 0 }),
      world({ trigger: 'resource.shortage', atMs: 10, colonyId: 'colony-2' }),
      world({ trigger: 'storage.full', atMs: 20 }),
    ], 60_000);
    expect(kept).toHaveLength(3);
    expect(coalesced).toBe(0);
  });
});

describe('W16-05 intent and critical upgrade', () => {
  it('keeps each player.intent_changed', () => {
    const events = [
      world({ trigger: 'player.intent_changed', atMs: 0 }),
      world({ trigger: 'player.intent_changed', atMs: 500 }),
    ];
    const { kept, coalesced, suppressed } = projectTriggers(events, 60_000);
    expect(kept).toEqual(events);
    expect(coalesced).toBe(0);
    expect(suppressed).toBe(0);
  });

  it('upgrades the kept event when a critical twin arrives inside the window', () => {
    const routine = world({ trigger: 'resource.shortage', atMs: 0 });
    const critical = world({ trigger: 'resource.shortage', atMs: 1_000, critical: true });
    const { kept, coalesced } = projectTriggers([routine, critical], 60_000);
    expect(kept).toEqual([{ ...routine, critical: true }]);
    expect(coalesced).toBe(1);
  });

  it('still upgrades when the critical event is earlier in time but later in input', () => {
    const routine = world({ trigger: 'hub.critical', atMs: 5_000 });
    const critical = world({ trigger: 'hub.critical', atMs: 1_000, critical: true });
    const { kept, coalesced } = projectTriggers([routine, critical], 60_000);
    expect(kept).toEqual([{ ...routine, critical: true }]);
    expect(coalesced).toBe(1);
  });
});

describe('W16-05 debounce from the cadence row', () => {
  it('is 60_000 ms because cadence.debounceS is 60', () => {
    const row = dataRow(compileData(parseWaves('..16')), 'director', 'cadence');
    expect(row.debounceS).toBe(60);
    expect(directorDebounceMs()).toBe(60_000);
  });
});
