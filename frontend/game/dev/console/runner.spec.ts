import { describe, expect, it, vi } from 'vitest';
import { defineFeature, selectFeatures, type DevCommandDef, type Feature, type FeatureContext } from '../../core/registry';
import { numArg, parseLine } from './parse';
import { CommandRunner } from './runner';

const cmd = (name: string, run: DevCommandDef['run'] = () => `${name} ran`): DevCommandDef => ({ name, help: `help for ${name}`, run });
const w00 = defineFeature({ id: 'a', wave: 'W00', devCommands: [cmd('zeta'), cmd('alpha')] });
const w07 = defineFeature({ id: 'b', wave: 'W07', devCommands: [cmd('warp')] });
const ctxFor = (flags: string[]): FeatureContext => ({ flags: new Set(flags), host: 'server', services: {} as FeatureContext['services'] });
const runnerFor = (all: Feature[], flags: string[]) => new CommandRunner(selectFeatures(all, { flags: new Set(flags), host: 'server' }), ctxFor(flags));
const text = async (r: CommandRunner, line: string) => {
  const out = await r.run(line);
  return out?.kind === 'text' ? out.text : out;
};

describe('help', () => {
  it('lists every command sorted, with its help, and only those of enabled features', async () => {
    const t = (await text(runnerFor([w07, w00], ['W00', 'W07']), 'help')) as string;
    expect(t.split('\n').map((l) => l.split(/\s+/)[0])).toEqual(['alpha', 'clear', 'help', 'warp', 'zeta']);
    expect(t).toContain('help for warp');
  });
  it('omits a disabled wave command (flags ..00)', async () => {
    const r = runnerFor([w07, w00], ['W00']);
    expect(r.names()).toEqual(['alpha', 'clear', 'help', 'zeta']);
    expect(await r.run('warp 10')).toMatchObject({ kind: 'text', error: true, text: expect.stringContaining('unknown command "warp"') });
  });
  it('help <name> describes one command', async () => {
    expect(await text(runnerFor([w00], ['W00']), 'help alpha')).toBe('alpha  help for alpha');
  });
});

describe('dispatch', () => {
  it('unknown command is a clear message', async () => {
    expect(await runnerFor([w00], ['W00']).run('nope')).toEqual({ kind: 'text', error: true, text: 'unknown command "nope". Type help for the list.' });
  });
  it('blank line is ignored; clear is a clear result', async () => {
    const r = runnerFor([w00], ['W00']);
    expect(await r.run('   ')).toBeNull();
    expect(await r.run('clear')).toEqual({ kind: 'clear' });
  });
  it('passes parsed args and ctx; awaits async results', async () => {
    const seen = vi.fn();
    const f = defineFeature({ id: 'c', wave: 'W00', devCommands: [cmd('echo', async (a, ctx) => { seen(a, ctx.host); return a.join('|'); })] });
    expect(await text(runnerFor([f], ['W00']), 'echo 1 "two words" 3')).toBe('1|two words|3');
    expect(seen).toHaveBeenCalledWith(['1', 'two words', '3'], 'server');
  });
  it('prints sync throws and async rejections as errors', async () => {
    const f = defineFeature({ id: 'c', wave: 'W00', devCommands: [cmd('boom', () => { throw new Error('bad'); }), cmd('late', async () => { throw new Error('nope'); })] });
    const r = runnerFor([f], ['W00']);
    expect(await r.run('boom')).toEqual({ kind: 'text', text: 'error: bad', error: true });
    expect(await r.run('late')).toEqual({ kind: 'text', text: 'error: nope', error: true });
    expect(await r.run('echo "x')).toMatchObject({ error: true, text: expect.stringContaining('unterminated') });
  });
  it('the first registration of a name wins', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f1 = defineFeature({ id: 'a1', wave: 'W00', devCommands: [cmd('dup', () => 'one')] });
    const f2 = defineFeature({ id: 'a2', wave: 'W00', devCommands: [cmd('dup', () => 'two')] });
    expect(await text(runnerFor([f1, f2], ['W00']), 'dup')).toBe('one');
  });
});

describe('arg parsing', () => {
  it('splits on whitespace and honours quotes', () => {
    expect(parseLine('  a  b\t"c d" \'e f\' ""')).toEqual(['a', 'b', 'c d', 'e f', '']);
  });
  it('numArg reads numbers, falls back, and names the bad argument', () => {
    expect(numArg(['3', '-1.5'], 1, 'r')).toBe(-1.5);
    expect(numArg([], 0, 'q', 7)).toBe(7);
    expect(() => numArg([], 0, 'id')).toThrow('missing <id>');
    expect(() => numArg(['x'], 0, 'q')).toThrow('<q> must be a number, got "x"');
  });
});
