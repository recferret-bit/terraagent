// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { directorDevCommands } from './devCommands';

const ctx: FeatureContext = { flags: new Set(['W16']), host: 'local', services: {} };

describe('W16-26 director dev tools', () => {
  it('is absent in production and prints a plan trace otherwise', async () => {
    expect(directorDevCommands('production')).toEqual([]);
    const commands = directorDevCommands('development');
    expect(commands.map((command) => command.name)).toEqual(['director.plan', 'director.trace']);
    const text = await commands[0]?.run([], ctx);
    expect(text).toContain('plan forced');
    expect(text).toContain('queue=1');
    expect(text).toContain('trace=mock');
  });
});
