import { describe, expect, it, vi } from 'vitest';
import { selectFeatures, type FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import { DevServerError } from '../../net/devServer';
import { devPresence } from './presence';

const view = {
  colonies: [
    { index: 0, id: 'col_0', name: 'A', color: 1, status: 'active' },
    { index: 2, id: 'col_2', name: 'B', color: 2, status: 'active' },
  ],
};

const seat = { planetId: 'pl_dev', colonyIndex: 2, colonyId: 'col_2' };

const run = async (line: string, devServer: FeatureContext['services']['devServer']) => {
  const runner = new CommandRunner([devPresence], {
    flags: new Set(['W09']),
    host: 'server',
    services: {
      devServer,
      session: { planetId: () => 'pl_dev' },
      colonyId: 2,
      store: { latest: view },
    } as FeatureContext['services'],
  });
  const result = await runner.run(line);
  return result?.kind === 'text' ? result.text : '';
};

describe('W09 dev console away, back, colony eliminate', () => {
  it('is hidden when W09 is off', () => {
    expect(selectFeatures([devPresence], { flags: new Set(['W00', 'W01']), host: 'server' })).toEqual([]);
    const on = selectFeatures([devPresence], { flags: new Set(['W09']), host: 'server' });
    expect(on[0]?.devCommands?.map((command) => command.name)).toEqual(['away', 'back', 'colony']);
  });

  it('parses away, back, and colony eliminate into server dev commands', async () => {
    const devServer = vi.fn(async (name: string) => {
      if (name === 'away') return { posted: true, away: true, tick: 4, appliedAtTick: 4 };
      if (name === 'back') return { posted: true, away: false, tick: 5, appliedAtTick: 5 };
      return { atTick: 6, startedAtMs: 1_700_000_000_000, event: 'colonyEliminated', cause: 'other' };
    });
    expect(await run('away', devServer)).toBe('away at tick 4');
    expect(await run('back', devServer)).toBe('back at tick 5');
    expect(await run('colony eliminate', devServer)).toBe('colonyEliminated at tick 6; hard-mode clock 1700000000000');
    expect(devServer).toHaveBeenNthCalledWith(1, 'away', seat);
    expect(devServer).toHaveBeenNthCalledWith(2, 'back', seat);
    expect(devServer).toHaveBeenNthCalledWith(3, 'colony.eliminate', seat);
  });

  it('rejects a present colony as not_away and does not call the server for a bad line', async () => {
    const devServer = vi.fn(async () => {
      throw new DevServerError('http_409', '409 not_away', 'NOT_AWAY');
    });
    expect(await run('colony eliminate', devServer)).toBe('error: not_away');
    expect(devServer).toHaveBeenCalledOnce();
    devServer.mockClear();
    expect(await run('colony', devServer)).toBe('error: usage: colony eliminate');
    expect(await run('away extra', devServer)).toBe('error: usage: away');
    expect(devServer).not.toHaveBeenCalled();
  });
});
