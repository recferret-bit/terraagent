import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { defineFeature, selectFeatures, type FeatureContext } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import { TREASURY_DEV_COMMANDS } from './devCommands';

const treasuryDev = defineFeature({
  id: 'treasury',
  wave: 'W22',
  devCommands: [...TREASURY_DEV_COMMANDS],
});

function runner(services: Partial<FeatureContext['services']> = {}, host: FeatureContext['host'] = 'server') {
  return new CommandRunner([treasuryDev], {
    flags: new Set(['W22']),
    host,
    services: { track: () => {}, ...services } as FeatureContext['services'],
  });
}

async function text(
  line: string,
  services: Partial<FeatureContext['services']> = {},
  host: FeatureContext['host'] = 'server',
) {
  const res = await runner(services, host).run(line);
  return res?.kind === 'text' ? res.text : '';
}

describe('W22-35 treasury dev console', () => {
  it('accepts treasury.effect meteor_shield and rejects treasury.effect nuke', async () => {
    const devServer = vi.fn(async () => ({ kind: 'meteor_shield', untilTick: 109_000, tick: 1_000 }));
    const sendCommand = vi.fn();
    const session = { planetId: () => 'pl_dune' } as FeatureContext['services']['session'];
    expect(await text('treasury.effect meteor_shield', { devServer, sendCommand, session })).toBe(
      'meteor_shield until tick 109000',
    );
    expect(devServer).toHaveBeenCalledWith('treasury.effect', { planetId: 'pl_dune', kind: 'meteor_shield' });
    expect(sendCommand).not.toHaveBeenCalled();
    expect(await text('treasury.effect nuke', { devServer, session })).toBe(
      'error: usage: treasury.effect <meteor_shield|terraform_boost|guild_subsidy>',
    );
    expect(devServer).toHaveBeenCalledTimes(1);
    expect(await text('treasury.effect terraform_boost', { devServer, session })).toContain('until tick');
    expect(await text('treasury.effect', { devServer, session })).toContain('usage:');
  });

  it('hides the commands when W22 is off and rejects a host with no server', async () => {
    const off = selectFeatures([treasuryDev], { flags: new Set(['W21']), host: 'server' });
    const hidden = await new CommandRunner(off, {
      flags: new Set(['W21']),
      host: 'server',
      services: { track: () => {} } as FeatureContext['services'],
    }).run('treasury.effect meteor_shield');
    expect(hidden?.kind === 'text' ? hidden.text : '').toContain('unknown command "treasury.effect"');
    const session = { planetId: () => 'pl_dune' } as FeatureContext['services']['session'];
    expect(await text('treasury.effect meteor_shield', { session }, 'local')).toContain('host_unavailable');
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain("wave: 'W22'");
    expect(source).toContain('TREASURY_DEV_COMMANDS');
  });

  it('parses fund, bounty post, complete, and merc.hire', async () => {
    const devServer = vi.fn(async (name: string) => {
      if (name === 'treasury.fund') return { balance: '1500' };
      if (name === 'bounty.post') return { id: 'bt_1', state: 'open', escrowId: 'esc_1' };
      if (name === 'bounty.complete') return { state: 'paid', paid: true, claimer: 'b.mock' };
      return { count: 4, endTick: 37_000, q: 2, r: -3 };
    });
    const session = { planetId: () => 'pl_dune', colonyId: () => 'co_a' } as FeatureContext['services']['session'];
    expect(await text('treasury.fund pl_dune 1500', { devServer, session })).toBe(
      'funded pl_dune metals.t1 1500 (balance 1500)',
    );
    expect(devServer).toHaveBeenCalledWith('treasury.fund', { planetId: 'pl_dune', amount: 1500 });
    expect(await text('bounty.post clear_nest 9 200', { devServer, session })).toContain('posted bt_1 clear_nest');
    expect(devServer).toHaveBeenCalledWith(
      'bounty.post',
      expect.objectContaining({
        planetId: 'pl_dune',
        colonyId: 'co_a',
        target: { kind: 'clear_nest', nestId: '9' },
        reward: { resource: 'metals.t1', amount: 200 },
      }),
    );
    expect(await text('bounty.post nuke 1', { devServer, session })).toContain('usage:');
    expect(await text('bounty.complete bt_1', { devServer, session })).toBe('bounty bt_1 paid (paid) claimer b.mock');
    expect(await text('merc.hire 2', { devServer, session })).toContain('hired light squad (4 recon)');
    expect(await text('merc.hire 2', { devServer, session })).toContain('escrow hire is not on this branch');
    expect(devServer).toHaveBeenCalledWith('merc.hire', expect.objectContaining({ planetId: 'pl_dune', hours: 2 }));
  });
});
