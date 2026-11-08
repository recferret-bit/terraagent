import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockElement } from '../test-dom';
import unitsFeature from './index';

describe('Units menu tier tabs', () => {
  const origDoc = globalThis.document;
  const origWin = globalThis.window;

  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new MockElement(tag) };
    (globalThis as unknown as { window: unknown }).window = { addEventListener: () => {}, removeEventListener: () => {} };
  });

  afterEach(() => {
    (globalThis as unknown as { document: unknown }).document = origDoc;
    (globalThis as unknown as { window: unknown }).window = origWin;
  });

  it('shows T1–T3 when those waves are on and filters the grid', () => {
    const parent = new MockElement('div');
    const ctx = {
      flags: new Set(['W00', 'W01', 'W02', 'W03', 'W05']),
      host: 'server' as const,
      services: { sendCommand: vi.fn(), track: vi.fn() },
    };
    const instance = unitsFeature.hud![0].mount(parent as unknown as HTMLElement, ctx);
    expect(parent.querySelector('[data-testid="prod-tier-t1"]')?.getAttribute('aria-selected')).toBe('true');
    expect(parent.querySelector('[data-testid="prod-tier-t2"]')).not.toBeNull();
    expect(parent.querySelector('[data-testid="prod-tier-t3"]')).not.toBeNull();
    expect(parent.querySelector('[data-unit="worker"][data-tier="1"]')?.getAttribute('data-tier-on')).toBe('true');
    expect(parent.querySelector('[data-unit="worker"][data-tier="2"]')?.getAttribute('data-tier-on')).toBe('false');
    parent.querySelector('[data-testid="prod-tier-t3"]')?.click();
    const t3 = parent.querySelector('[data-unit="worker"][data-tier="3"]');
    expect(t3?.getAttribute('data-tier-on')).toBe('true');
    expect(t3?.getAttribute('data-queue-tier')).toBe('3');
    expect(parent.querySelector('[data-unit="worker"][data-tier="1"]')?.getAttribute('data-tier-on')).toBe('false');
    expect(t3?.querySelector('.ta-units__title')?.textContent).toBe('Worker Drone T3');
    expect(t3?.querySelector('.ta-card-tier')?.textContent).toBe('T3');
    expect(t3?.querySelector('.ta-card-face')?.querySelector('.ta-card-time')?.textContent).toBe('12s');
    expect(t3?.querySelector('.ta-card-face')?.querySelector('.ta-units__time')).toBeNull();
    expect(t3?.querySelector('.ta-card-tip')?.querySelector('.ta-units__time')?.textContent).toBe('12s');
    expect(t3?.querySelector('.ta-card-tip')?.querySelector('.ta-card-role')?.textContent).toBe('Harvest, build, and terraform');
    instance.dispose();
  });
});
