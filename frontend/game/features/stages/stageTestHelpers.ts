import { expect } from 'vitest';
import { parseWaves } from '@terra/contracts';
import type { FeatureContext } from '../../core/registry/types';

export function makeMockContext(flagsList = '..08', transport?: unknown): FeatureContext {
  return {
    flags: new Set(parseWaves(flagsList).list),
    host: 'server',
    services: {
      track: () => {},
      colonyId: 0,
      session: { planetId: () => 'test-planet' },
      ...(transport ? { transport: transport as never } : {}),
    },
  };
}

export interface MockTransport {
  transport: {
    send: (m: unknown) => void;
    onMessage: (fn: (m: unknown) => void) => () => void;
  };
  emit: (m: unknown) => void;
}

export function makeMockTransport(): MockTransport {
  type Listener = (m: unknown) => void;
  const listeners: Listener[] = [];
  return {
    transport: {
      send: () => {},
      onMessage: (fn: Listener) => {
        listeners.push(fn);
        return () => {
          const idx = listeners.indexOf(fn);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      },
    },
    emit: (m: unknown) => {
      for (const fn of listeners) fn(m);
    },
  };
}

export interface ExpectedUnlocks {
  units?: readonly string[];
  buildings?: readonly string[];
  orders?: readonly string[];
}

export function expectToastUnlocks(container: HTMLElement, unlocks: ExpectedUnlocks): void {
  const reveal = container.querySelector('[data-testid="stage-unlock-reveal"]');
  expect(reveal).not.toBeNull();
  const revealText = reveal?.textContent ?? '';

  if (unlocks.units) {
    const text = container.querySelector('[data-testid="stage-unlock-units"]')?.textContent ?? '';
    for (const u of unlocks.units) {
      expect(text).toContain(u);
      expect(revealText).toContain(u);
    }
  }

  if (unlocks.buildings) {
    const text = container.querySelector('[data-testid="stage-unlock-buildings"]')?.textContent ?? '';
    for (const b of unlocks.buildings) {
      expect(text).toContain(b);
      expect(revealText).toContain(b);
    }
  }

  if (unlocks.orders) {
    const text = container.querySelector('[data-testid="stage-unlock-orders"]')?.textContent ?? '';
    for (const o of unlocks.orders) {
      expect(text).toContain(o);
      expect(revealText).toContain(o);
    }
  }
}
