import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import tune from './index';

const run = async (line: string, services: Partial<FeatureContext['services']>) => {
  const r = await new CommandRunner([tune], { flags: new Set(['W00']), host: 'server', services: services as FeatureContext['services'] }).run(line);
  return r?.kind === 'text' ? r.text : '';
};
const session = { planetId: () => 'pl_1' };

describe('tune console command', () => {
  it('set sends the path and value with the session planet and prints the new hash', async () => {
    const devServer = vi.fn(async () => ({ dataHash: 'abc123', overrides: {} }));
    expect(await run('tune dev.probe.nudgeTiles 3', { devServer, session })).toContain('data hash abc123');
    expect(devServer).toHaveBeenCalledWith('tune', { planetId: 'pl_1', op: 'set', path: 'dev.probe.nudgeTiles', value: '3' });
  });
  it('reset and export', async () => {
    const devServer = vi.fn(async (_n: string, a?: unknown) => ((a as { op: string }).op === 'export' ? { dataHash: 'h', overrides: {}, text: '{}' } : { dataHash: 'orig', overrides: {} }));
    expect(await run('tune reset', { devServer, session })).toContain('orig');
    expect(await run('tune export', { devServer, session })).toBe('{}');
  });
  it('errors: no value, no planet yet, no server', async () => {
    const devServer = vi.fn();
    expect(await run('tune dev.probe.nudgeTiles', { devServer, session })).toContain('missing <value>');
    expect(await run('tune reset', { devServer, session: { planetId: () => null } })).toContain('not connected to a planet');
    expect(await run('tune reset', { session })).toContain('host_unavailable');
    expect(devServer).not.toHaveBeenCalled();
  });
});
