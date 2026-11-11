// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { mountRaidFeature, raidFeature } from './index';

function createHarness(flags = ['W18'], ownColonyIndex = 0) {
  const el = document.createElement('div');
  const commands: Array<{ kind: string; args: unknown }> = [];
  const trackedEvents: Array<{ name: string; props?: Record<string, any> }> = [];

  let viewListener: ((v: any) => void) | undefined;
  let serverEventsListener: ((events: readonly any[]) => void) | undefined;

  const sendCommand = vi.fn(async (kind: string, args?: unknown): Promise<any> => {
    commands.push({ kind, args });
    return { ok: true, appliedAtTick: 1 };
  });

  const ctx: FeatureContext = {
    flags: new Set(flags),
    host: 'server',
    services: {
      track: (name: string, props?: Record<string, any>) => {
        trackedEvents.push({ name, props });
      },
      sendCommand: sendCommand as any,
      colonyId: ownColonyIndex,
      store: {
        currentPlanetId: () => 'planet-mars-1',
        onView: (cb: any) => {
          viewListener = cb;
          return () => {
            viewListener = undefined;
          };
        },
        onServerEvents: (cb: any) => {
          serverEventsListener = cb;
          return () => {
            serverEventsListener = undefined;
          };
        },
      } as any,
    },
  };

  const mounted = mountRaidFeature(el, ctx);

  return {
    el,
    ctx,
    commands,
    trackedEvents,
    mounted,
    pushView: (v: unknown) => {
      viewListener?.(v);
      mounted.update(v as any);
    },
    pushServerEvents: (evs: readonly any[]) => {
      serverEventsListener?.(evs);
    },
  };
}

describe('Raid Target Picker Integration - Positive and Wave Gating', () => {
  it('positive: eligible neighbor colony enables raid dispatch and updates path indicator', () => {
    const { el, commands, pushView, mounted } = createHarness(['W18'], 0);
    expect(el.hidden).toBe(false);

    pushView({
      tick: 100,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        { index: 1, id: 'col_1', name: 'Neighbor Alpha', discovered: true, q: 4, r: -2 },
      ],
    });

    const row = el.querySelector<HTMLElement>('[data-testid="raid-target-row"]')!;
    expect(row).not.toBeNull();
    expect(row.getAttribute('data-disabled')).toBe('false');

    const dispatchBtn = el.querySelector<HTMLButtonElement>('[data-testid="raid-target-dispatch"]')!;
    expect(dispatchBtn.disabled).toBe(false);

    dispatchBtn.click();

    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      kind: 'raid',
      args: { targetColonyId: 'col_1', targetColonyIndex: 1 },
    });

    const indicator = el.querySelector<HTMLElement>('[data-testid="raid-path-indicator"]')!;
    expect(indicator.hidden).toBe(false);
    expect(indicator.textContent).toContain('Neighbor Alpha (4, -2)');

    mounted.dispose();
  });

  it('negative: hides feature and ignores interactions when W18 wave flag is inactive', () => {
    const { el, mounted } = createHarness(['W00', 'W07'], 0);
    expect(el.hidden).toBe(true);
    expect(el.querySelector('[data-testid="raid-target-picker"]')).toBeNull();

    mounted.dispose();
  });

  it('feature definition metadata check', () => {
    expect(raidFeature.id).toBe('raid');
    expect(raidFeature.wave).toBe('W18');
    expect(raidFeature.hud?.[0]?.slot).toBe('bottom-right');
  });
});

describe('Raid Target Picker Integration - Shield and Analytics', () => {
  it('negative: disabled target with newcomer shield displays status badge and blocks dispatch', () => {
    const { el, commands, pushView, mounted } = createHarness(['W18'], 0);

    pushView({
      tick: 1000,
      colonies: [
        { index: 0, id: 'col_0', discovered: true },
        {
          index: 1,
          id: 'col_1',
          name: 'Protected Hub',
          discovered: true,
          raidProtectedUntil: 91000,
          q: 1,
          r: 1,
        },
      ],
    });

    const reasonBadge = el.querySelector<HTMLElement>('[data-testid="raid-target-reason"]')!;
    expect(reasonBadge).not.toBeNull();
    expect(reasonBadge.textContent).toContain('Protected 300:00 (newcomer shield: 5 h left)');
    expect(reasonBadge.title).toContain('newcomer shield');

    const dispatchBtn = el.querySelector<HTMLButtonElement>('[data-testid="raid-target-dispatch"]')!;
    expect(dispatchBtn.disabled).toBe(true);

    const row = el.querySelector<HTMLElement>('[data-testid="raid-target-row"]')!;
    row.click();
    dispatchBtn.click();

    expect(commands).toHaveLength(0);

    mounted.dispose();
  });

  it('analytics: wires createPvpTracker and emits raid_started on sim event', () => {
    const { pushServerEvents, trackedEvents, mounted } = createHarness(['W18'], 0);

    pushServerEvents([
      {
        kind: 'raidStarted',
        data: {
          raidId: 'raid_abc',
          targetColonyId: 'col_victim',
          count: 3,
        },
      },
    ]);

    expect(trackedEvents).toHaveLength(1);
    expect(trackedEvents[0]).toEqual({
      name: 'raid_started',
      props: {
        colonyId: '0',
        targetColonyId: 'col_victim',
        unitCount: 3,
        planetId: 'planet-mars-1',
      },
    });

    mounted.dispose();
  });
});
