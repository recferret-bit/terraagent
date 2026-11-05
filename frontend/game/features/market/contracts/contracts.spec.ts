// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { contractSignedText, formatFeePercent, resourceDisplayName } from '@terra/contracts';
import { RESOURCE_LABELS } from '../../shared/resources';
import { ContractsController, SETTLEMENT_FAILED_TEXT } from './ContractsController';
import { ContractsLog, CONTRACTS_LIMIT } from './contractsLog';
import { ContractsPanel } from './ContractsPanel';

const settled = (tradeId: string, over: Record<string, unknown> = {}) => ({
  kind: 'tradeSettled', atTick: 9,
  data: { tradeId, colonyId: 'c1', colonyIndex: 0, role: 'buyer', base: 'bio.water', amount: 300, quote: 'USDC', notional: '10000000', platformFee: '100000', stallFee: '100000', stallFeeBp: 100, makerSide: 'sell', stallName: 'Port A', ...over },
});

function setup(owner: number | undefined = 0) {
  const toasts: Array<[string, string]> = [];
  const log = new ContractsLog();
  const ctl = new ContractsController(log, (m, s) => { toasts.push([m, s]); }, () => owner);
  const panel = new ContractsPanel(document.createElement('div'), log);
  return { toasts, log, ctl, panel };
}

describe('W13-24 contract text', () => {
  it('matches the demo toast exactly', () => {
    expect(contractSignedText({ base: 'bio.water', amount: 300, quote: 'USDC', notional: '10000000', stallFeeBp: 100, stallName: 'Port A' }))
      .toBe('Contract signed: 300 water for 10.00 USDC at Port A (1 % fee)');
  });
  it('formats fee percent and falls back without a stall name', () => {
    expect([0, 50, 25, 100].map(formatFeePercent)).toEqual(['0', '0.5', '0.25', '1']);
    expect(contractSignedText({ base: 'metals.t1', amount: 5, quote: 'bio.water', notional: '7', stallFeeBp: 0 })).toBe('Contract signed: 5 metals for 7 water at the market (0 % fee)');
  });
  it('resource names are the lower-cased HUD names', () => {
    for (const [key, label] of Object.entries(RESOURCE_LABELS)) expect(resourceDisplayName(key)).toBe(label.toLowerCase().replace(/ t(\d)/, ' T$1'));
  });
});

describe('W13-24 contracts controller and list', () => {
  const text = 'Contract signed: 300 water for 10.00 USDC at Port A (1 % fee)';

  it('toasts the exact text for buyer and seller and lists the trade once (a re-sent event adds nothing)', () => {
    const { toasts, log, ctl, panel } = setup();
    ctl.handle([settled('tr_1') as never]);
    ctl.handle([settled('tr_1') as never]);
    expect(toasts).toEqual([[text, 'info']]);
    expect(log.list).toHaveLength(1);
    void panel;
    const seller = setup();
    seller.ctl.handle([settled('tr_1', { role: 'seller' }) as never]);
    expect(seller.toasts[0]![0]).toBe(text);
  });

  it('renders rows with the MOCK badge, opens and closes', () => {
    const { ctl, panel } = setup();
    const root = (panel as unknown as { root: HTMLElement }).root;
    expect(panel.isOpen).toBe(false);
    expect(root.textContent).toContain('No contracts yet');
    ctl.handle([settled('tr_1') as never]);
    panel.toggle();
    expect(panel.isOpen).toBe(true);
    const row = root.querySelector('[data-testid=contract-row]')!;
    expect(row.textContent).toContain(text);
    expect(row.textContent).toContain('MOCK USDC');
    panel.toggle();
    expect(panel.isOpen).toBe(false);
  });

  it('keeps only the newest 20, newest first', () => {
    const { ctl, log } = setup();
    for (let i = 0; i < 25; i++) ctl.handle([settled(`tr_${i}`, { amount: i + 1 }) as never]);
    expect(log.list).toHaveLength(CONTRACTS_LIMIT);
    expect(log.list[0]!.text).toContain('25 water');
    expect(log.list.at(-1)!.text).toContain('6 water');
  });

  it('toasts a failed contract for a settlement failure and a refused order; ignores another colony', () => {
    const { toasts, log, ctl } = setup(0);
    ctl.handle([
      { kind: 'marketSettlementFailed', data: { colonyId: 'c1', colonyIndex: 0, ref: 'o1' } },
      { kind: 'marketOrderRejected', data: { colonyId: 'c1', colonyIndex: 0, ref: 'o2', code: 'insufficient_cargo', detail: 'not enough water in orbit' } },
      settled('tr_other', { colonyIndex: 1 }),
    ] as never);
    expect(toasts).toEqual([[SETTLEMENT_FAILED_TEXT, 'warning'], ['Contract failed: not enough water in orbit', 'warning']]);
    expect(log.list.map((r) => r.kind)).toEqual(['history.trade.failed', 'history.trade.failed']);
  });

  it('subscribes to the store server events and unsubscribes on dispose', () => {
    let fn: ((e: never[]) => void) | undefined;
    const off = vi.fn();
    const toast = vi.fn();
    const ctl = new ContractsController(new ContractsLog(), toast, () => undefined, { onServerEvents: (f) => { fn = f as never; return off; } });
    fn!([settled('tr_9') as never]);
    expect(toast).toHaveBeenCalledWith(text, 'info', 6000, 'contract:tr_9:c1');
    ctl.dispose();
    expect(off).toHaveBeenCalled();
  });
});
