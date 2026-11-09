// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LAST_WAVE } from '@terra/contracts';
import type { FeatureContext } from '../../core/registry/types';
import flagsFeature from './index';

describe('flags command (FA-30)', () => {
  it('mounts no HUD panel; the flags dev command prints the on-count and source', () => {
    expect(!flagsFeature.hud?.length).toBe(true);
    const flags = new Set(['W00', 'W01']);
    const ctx = { flags, host: 'server', services: { flagsSource: 'welcome' } } as unknown as FeatureContext;
    const cmd = flagsFeature.devCommands?.find((c) => c.name === 'flags');
    expect(cmd).toBeDefined();
    expect(cmd!.run([], ctx)).toBe(`2/${LAST_WAVE + 1} on (server): W00 W01`);
  });
});
