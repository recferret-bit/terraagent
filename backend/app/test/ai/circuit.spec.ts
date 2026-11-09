import { describe, expect, it } from 'vitest';
import { ProviderCircuit, circuitSettings } from '../../src/ai/budget/circuit.js';

describe('W16-14 provider circuit', () => {
  it('opens after the configured failure count and allows one probe after the window', () => {
    const settings = circuitSettings();
    expect(settings.failuresToOpen).toBe(5);
    expect(settings.openMs).toBe(60_000);
    const circuit = new ProviderCircuit(settings);
    for (let i = 0; i < 4; i++) circuit.recordFailure(0);
    expect(circuit.allow(0)).toBe(true);
    circuit.recordFailure(1_000);
    expect(circuit.allow(1_000)).toBe(false);
    expect(circuit.allow(1_000 + settings.openMs)).toBe(true);
    circuit.recordFailure(1_000 + settings.openMs);
    expect(circuit.allow(1_000 + settings.openMs)).toBe(false);
  });

  it('closes on success so later calls are allowed', () => {
    const circuit = new ProviderCircuit({ failuresToOpen: 1, openMs: 1_000 });
    circuit.recordFailure(0);
    expect(circuit.allow(0)).toBe(false);
    circuit.recordSuccess();
    expect(circuit.allow(0)).toBe(true);
  });
});
