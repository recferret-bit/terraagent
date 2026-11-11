import { describe, expect, it, vi } from 'vitest';
import { selectFeatures, type FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import guildDev from './index';

const view = { colonies: [{ index: 0, id: 'col_0', name: 'A', color: 1, status: 'active' }] };

function runner(devServer: FeatureContext['services']['devServer'], flags = ['W15']) {
  return new CommandRunner(selectFeatures([guildDev], { flags: new Set(flags), host: 'server' }), {
    flags: new Set(flags),
    host: 'server',
    services: {
      devServer,
      session: { planetId: () => 'pl_dev', colonyId: () => 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      store: { latest: view },
      track: () => {},
    } as unknown as FeatureContext['services'],
  });
}

describe('W15-28 guild dev commands', () => {
  it('is hidden when W15 is off and absent on the local host', () => {
    expect(selectFeatures([guildDev], { flags: new Set(['W00']), host: 'server' })).toEqual([]);
    expect(selectFeatures([guildDev], { flags: new Set(['W15']), host: 'local' })).toEqual([]);
    expect(selectFeatures([guildDev], { flags: new Set(['W15']), host: 'server' })[0]?.devCommands?.map((c) => c.name)).toEqual([
      'guild.summon', 'guild.depart', 'guild.setInventory', 'guild.disable', 'away.simulate', 'director.allowance',
    ]);
  });

  it('sends guild.summon kestrel and rejects a missing npc before the server', async () => {
    const devServer = vi.fn(async () => ({ name: 'Kestrel', placed: 6, offers: 6 }));
    const on = runner(devServer);
    const text = await on.run('guild.summon kestrel');
    expect(text).toMatchObject({ kind: 'text', text: 'Kestrel docked — 6 quotes' });
    expect(devServer).toHaveBeenCalledWith('guild.summon', { planetId: 'pl_dev', npc: 'kestrel' });
    const missing = await on.run('guild.summon');
    expect(missing).toMatchObject({ kind: 'text', error: true });
    expect(devServer).toHaveBeenCalledTimes(1);
  });
});
