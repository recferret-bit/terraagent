import { describe, expect, it } from 'vitest';
import { createRootLogger, layerLogger, parseLayerLevels } from '../../src/core/logging/logger';
import { PinoNestLogger } from '../../src/core/logging/nest-logger';

function capture(level = 'info') {
  const lines: Record<string, unknown>[] = [];
  const root = createRootLogger({ level, nodeEnv: 'test', destination: { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) } });
  return { root, lines };
}

describe('logging', () => {
  it('redacts PII', () => {
    const { root, lines } = capture();
    root.info({ user: { email: 'a@b.c', accessToken: 't', password: 'p', name: 'ok' }, token: 'x', req: { headers: { authorization: 'Bearer z', cookie: 'c=1', accept: '*/*' } } }, 'hi');
    const l = JSON.stringify(lines[0]);
    for (const secret of ['a@b.c', '"t"', '"p"', '"x"', 'Bearer z', 'c=1']) expect(l).not.toContain(secret);
    expect(lines[0]).toMatchObject({ user: { name: 'ok', email: '[REDACTED]' }, req: { headers: { accept: '*/*' } } });
  });

  it('parses LOG_LEVELS and ignores junk', () => {
    expect(parseLayerLevels('sim=warn, http=info,bogus=debug,x')).toEqual({ sim: 'warn', http: 'info' });
  });

  it('per-layer level override', () => {
    const { root, lines } = capture('info');
    const sim = layerLogger(root, 'sim', 'sim=warn');
    const http = layerLogger(root, 'http', 'sim=warn');
    sim.info('dropped');
    sim.warn('kept');
    http.info('http kept');
    expect(lines.map((l) => [l.layer, l.msg])).toEqual([['sim', 'kept'], ['http', 'http kept']]);
  });

  it('Nest logger adapter goes through pino with ctx', () => {
    const { root, lines } = capture();
    new PinoNestLogger(root).log('started', 'NestApplication');
    expect(lines[0]).toMatchObject({ msg: 'started', ctx: 'NestApplication', level: 30 });
  });
});
