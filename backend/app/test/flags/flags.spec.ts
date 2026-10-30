import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { EnvError } from '@terra/config';
import { commandGate } from '../../src/flags/flags.service';
import { createApp } from '../../src/app';
import { FlagsService } from '../../src/flags/flags.service';

const fixtureWaves: Record<string, string> = { 'dev.ping': 'W00', 'build.place': 'W01' };
const waveOf = (k: string) => fixtureWaves[k];

describe('command gate', () => {
  it('rejects a W01 command when TA_WAVES=..00', () => {
    const flags = parseWaves('..00');
    expect(commandGate('build.place', flags, waveOf)).toBe('wave_disabled');
    expect(commandGate('dev.ping', flags, waveOf)).toBeNull();
    expect(commandGate('nope', flags, waveOf)).toBe('unknown_kind');
  });
  it('uses the generated contract kinds by default', () => {
    expect(commandGate('dev.ping', parseWaves('..00'))).toBeNull();
    expect(commandGate('not.a.kind', parseWaves('all'))).toBe('unknown_kind');
  });
});

describe('FlagsService in the app', () => {
  it('reads TA_WAVES and lists the welcome flags', async () => {
    const { app } = await createApp({ source: { TA_WAVES: '..00' } });
    const flags = app.get(FlagsService);
    expect(flags.list).toEqual(['W00']);
    expect(flags.gate('dev.ping')).toBeNull();
    await app.close();
  });
  it('aborts boot on a malformed TA_WAVES', async () => {
    await expect(createApp({ source: { TA_WAVES: '..7x' } })).rejects.toThrow(EnvError);
    await expect(createApp({ source: { TA_WAVES: '..7x' } })).rejects.toThrow(/TA_WAVES/);
  });
});
