// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { StakeProfitsControl, validateUsdcAmount, type NearMode } from './stakeProfitsView';

const q = (c: StakeProfitsControl, id: string): HTMLElement => c.dialog.querySelector(`[data-testid="${id}"]`)!;
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
const quote = (dry: boolean) => ({ amountInUsdc: '12.5', amountInAtomic: '12500000', amountOutNear: '3.125', nearUsd: 4, source: 'mock', dry });
const okBody = (dry: boolean) => ({ quote: quote(dry), txHash: dry ? null : 'tx1', position: null, walletBalanceNear: '0' });

function make(mode: NearMode, doFetch: ReturnType<typeof vi.fn>): { c: StakeProfitsControl; onStaked: ReturnType<typeof vi.fn> } {
  const onStaked = vi.fn();
  const c = new StakeProfitsControl({ doFetch: doFetch as unknown as (i: string, init?: RequestInit) => Promise<Response>, token: 'tok', accountId: () => 'a.near', mode: () => mode, onStaked });
  c.update(50_000_000n);
  return { c, onStaked };
}
const submit = async (c: StakeProfitsControl, amount: string): Promise<void> => {
  c.button.click();
  (q(c, 'stake-profits-amount') as HTMLInputElement).value = amount;
  (q(c, 'stake-profits-submit') as HTMLButtonElement).click();
  await vi.waitFor(() => expect((q(c, 'stake-profits-submit') as HTMLButtonElement).disabled).toBe(false));
};

describe('validateUsdcAmount', () => {
  it('accepts positive amounts within the free balance (boundary included)', () => {
    expect(validateUsdcAmount('12.5', 50_000_000n)).toBeNull();
    expect(validateUsdcAmount('50', 50_000_000n)).toBeNull();
    expect(validateUsdcAmount('0.000001', 1n)).toBeNull();
  });
  it('rejects junk, signs, 7 decimals, zero and more than free', () => {
    for (const bad of ['', 'abc', '-1', '1e3', '1.1234567', '1,5', '.5']) expect(validateUsdcAmount(bad, 50_000_000n)).toMatch(/USDC amount/);
    expect(validateUsdcAmount('0', 1n)).toMatch(/greater than 0/);
    expect(validateUsdcAmount('0.00', 1n)).toMatch(/greater than 0/);
    expect(validateUsdcAmount('50.000001', 50_000_000n)).toMatch(/free in your wallet/);
  });
});

describe('StakeProfitsControl', () => {
  it('shows the button only while free USDC > 0', () => {
    const { c } = make('mock', vi.fn());
    expect(c.button.hidden).toBe(false);
    c.button.click();
    expect(c.dialog.hidden).toBe(false);
    c.update(0n);
    expect(c.button.hidden).toBe(true);
    expect(c.dialog.hidden).toBe(true);
  });
  it('mock: stakes (dry:false), toasts, and asks the page to refresh perks', async () => {
    const f = vi.fn().mockResolvedValue(json(200, okBody(false)));
    const { c, onStaked } = make('mock', f);
    await submit(c, '12.5');
    const body = JSON.parse(f.mock.calls[0]![1].body as string);
    expect(body).toEqual({ amountUsdc: '12.5', dry: false, accountId: 'a.near' });
    expect(f.mock.calls[0]![1].headers.authorization).toBe('Bearer tok');
    expect(q(c, 'stake-profits-msg').textContent).toContain('Staked 3.125 NEAR');
    expect(onStaked).toHaveBeenCalledTimes(1);
  });
  it('testnet: dry quote only, nothing staked, no refresh', async () => {
    const f = vi.fn().mockResolvedValue(json(200, okBody(true)));
    const { c, onStaked } = make('testnet', f);
    expect(q(c, 'stake-profits-submit').textContent).toBe('GET QUOTE');
    await submit(c, '12.5');
    expect(JSON.parse(f.mock.calls[0]![1].body as string).dry).toBe(true);
    expect(q(c, 'stake-profits-msg').textContent).toContain('Dry run, nothing staked');
    expect(onStaked).not.toHaveBeenCalled();
  });
  it('invalid input never calls the server', async () => {
    const f = vi.fn();
    const { c } = make('mock', f);
    await submit(c, 'abc');
    await submit(c, '51');
    expect(f).not.toHaveBeenCalled();
    expect(q(c, 'stake-profits-msg').textContent).toContain('free in your wallet');
  });
  it('404 disables the button with a tooltip', async () => {
    const { c } = make('mock', vi.fn().mockResolvedValue(json(404, {})));
    c.button.click();
    (q(c, 'stake-profits-amount') as HTMLInputElement).value = '1';
    (q(c, 'stake-profits-submit') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(c.button.disabled).toBe(true));
    expect(c.button.title).toMatch(/not available/);
    expect(c.dialog.hidden).toBe(true);
    c.button.click();
    expect(c.dialog.hidden).toBe(true);
  });
  it('server error, malformed body and network failure show an error and re-enable submit', async () => {
    const cases: Array<[ReturnType<typeof vi.fn>, RegExp]> = [
      [vi.fn().mockResolvedValue(json(400, { error: { message: 'amount too low' } })), /amount too low/],
      [vi.fn().mockResolvedValue(json(500, null)), /Request failed \(500\)/],
      [vi.fn().mockResolvedValue(json(200, { nope: 1 })), /Unexpected response/],
      [vi.fn().mockRejectedValue(new Error('down')), /Could not reach/],
    ];
    for (const [f, re] of cases) {
      const { c, onStaked } = make('mock', f);
      await submit(c, '1');
      expect(q(c, 'stake-profits-msg').textContent).toMatch(re);
      expect(onStaked).not.toHaveBeenCalled();
    }
  });
  it('MAX fills the free balance', () => {
    const { c } = make('mock', vi.fn());
    c.button.click();
    (q(c, 'stake-profits-max') as HTMLButtonElement).click();
    expect((q(c, 'stake-profits-amount') as HTMLInputElement).value).toBe('50.00');
  });
});
