import { describe, expect, it, vi } from 'vitest';
import { httpLedgerQuery, sessionLedgerQuery, type LedgerReply } from './devServer';

const reply = (planetId: string, account: string): LedgerReply => ({ planetId, account, balances: { 'metals.t1': 5 }, entries: [] });

describe('ledger query', () => {
  it('online: GET /v1/dev/planets/:planetId/ledger with account and limit; errors and no planet are DevServerErrors', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(reply('pl_1', 'colony:0')), { status: 200 }));
    const q = httpLedgerQuery(() => 'pl_1', '', fetchImpl as unknown as typeof fetch);
    expect(await q('colony:0', 10)).toEqual(reply('pl_1', 'colony:0'));
    expect(fetchImpl).toHaveBeenCalledWith('/v1/dev/planets/pl_1/ledger?account=colony%3A0&limit=10');
    const missing = httpLedgerQuery(() => 'pl_x', '', (async () => new Response('{"message":"no planet"}', { status: 404 })) as unknown as typeof fetch);
    await expect(missing('colony:0', 1)).rejects.toMatchObject({ code: 'not_found' });
    await expect(httpLedgerQuery(() => null)('colony:0', 1)).rejects.toMatchObject({ code: 'not_connected' });
  });

  it('session: the in-process host first, then the local-host worker, else the server', async () => {
    const view = vi.fn((planetId: string, account: string) => reply(planetId, account));
    let inProcess: { ledger: { view: typeof view } } | null = { ledger: { view } };
    const worker = vi.fn(async (_name: string, args?: unknown) => reply('local', (args as { account: string }).account));
    const q = sessionLedgerQuery(() => inProcess, worker, () => 'pl_dev');
    expect((await q('colony:0', 3)).planetId).toBe('pl_dev');
    expect(view).toHaveBeenCalledWith('pl_dev', 'colony:0', 3);
    inProcess = null;
    expect((await q('sys:dev', 4)).account).toBe('sys:dev');
    expect(worker).toHaveBeenCalledWith('ledger', { account: 'sys:dev', limit: 4 });
  });
});
