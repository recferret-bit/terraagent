// @vitest-environment jsdom
import type { MarketPolicyView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { initialState, type TradeState } from '../model/state';
import { renderFills } from './ordersView';
import { formatTicketFeeTier, OrderTicket } from './ticketView';

function makePolicy(overrides: Partial<MarketPolicyView> = {}): MarketPolicyView {
  return {
    policyVersion: 'v1',
    policyHash: 'h1',
    platformFeeBp: 100,
    standardPlatformFeeBp: 100,
    stakerPlatformFeeBp: 50,
    minStakeNear: '10',
    daoFeeShareBp: 2_000,
    stallFeeMaxBp: 100,
    stallFeeDefaultBp: 25,
    ttlOptionsS: [3600],
    openOrderLimit: 20,
    minNotional: { USDC: '100000' },
    ...overrides,
  };
}

describe('OrderTicket staker fee tier & 4-way split preview', () => {
  it('does NOT falsely display STAKER PERK ACTIVE when server NEAR_PLATFORM_FEE_BP is customized <= 50 for an unstaked visitor', () => {
    const unstaked50 = formatTicketFeeTier(
      makePolicy({
        platformFeeBp: 50,
        standardPlatformFeeBp: 50,
        stakerPlatformFeeBp: 25,
        minStakeNear: '25',
      }),
    );
    expect(unstaked50.isStaker).toBe(false);
    expect(unstaked50.text).not.toContain('STAKER PERK ACTIVE');
    expect(unstaked50.text).toContain('Platform Fee: 0.50%');
    expect(unstaked50.text).toContain('≥25 NEAR');
    expect(unstaked50.text).toContain('50% Lower Fee (0.25%)');

    // Even when standardPlatformFeeBp is omitted on legacy/anonymous policy payloads:
    const legacyAnon = formatTicketFeeTier({
      ...makePolicy({ platformFeeBp: 40 }),
      standardPlatformFeeBp: undefined,
    });
    expect(legacyAnon.isStaker).toBe(false);
    expect(legacyAnon.text).not.toContain('STAKER PERK ACTIVE');
  });

  it('displays STAKER PERK ACTIVE and custom DAO/Protocol split in OrderTicket DOM when stakerDiscountActive is true', () => {
    const state: TradeState = {
      ...initialState('planet-1', 'bio.water/USDC'),
      policy: makePolicy({
        platformFeeBp: 45,
        standardPlatformFeeBp: 120,
        stakerPlatformFeeBp: 45,
        minStakeNear: '15',
        stakerDiscountActive: true,
        daoFeeShareBp: 2_500,
      }),
      balances: {
        planetId: 'planet-1',
        colonyId: 'col_0',
        quote: { USDC: { free: '50000000', reserved: '0', total: '50000000' } },
        inOrbit: { 'bio.water': { free: '1000', reserved: '0', total: '1000' } },
      },
    };

    const ticket = new OrderTicket({
      client: { place: vi.fn(), agentQuote: vi.fn() } as never,
      state: () => state,
      onSent: () => {},
    });
    document.body.appendChild(ticket.root);
    ticket.root.querySelector<HTMLButtonElement>('[data-testid="ticket-side-buy"]')!.click();
    const amt = ticket.root.querySelector<HTMLInputElement>('[data-testid="ticket-amount"]')!;
    const total = ticket.root.querySelector<HTMLInputElement>('[data-testid="ticket-total"]')!;
    amt.value = '100';
    total.value = '10';
    amt.dispatchEvent(new Event('input'));

    const tierEl = ticket.root.querySelector<HTMLElement>('[data-testid="ticket-fee-tier"]')!;
    expect(tierEl.classList.contains('is-staker')).toBe(true);
    expect(tierEl.textContent).toBe('★ STAKER PERK ACTIVE: 0.45% Platform Fee (Down from 1.20% — ≥15 NEAR Staked)');
    expect(ticket.root.textContent).toContain('PLANET DAO (25%)');
    expect(ticket.root.textContent).toContain('TERRAAGENT PROTOCOL (75%)');
    ticket.root.remove();
  });
});

describe('ordersView fill receipt explorer routing', () => {
  it('links mock fill receipts to /dev/chain/tx and live NEAR tx hashes to NearBlocks Testnet', () => {
    const base = initialState('planet-1', 'bio.water/USDC');
    const state: TradeState = {
      ...base,
      panels: { ...base.panels, fills: { status: 'ready' } },
      fills: [
        {
          tradeId: 't_mock',
          orderId: 'o_1',
          pair: 'bio.water/USDC',
          base: 'bio.water',
          quote: 'USDC',
          side: 'buy',
          makerSide: 'sell',
          amount: 10,
          notional: '10000000',
          platformFee: '100000',
          stallFee: '50000',
          stallFeeBp: 50,
          counterpartyKind: 'player',
          state: 'FINAL',
          txHash: 'mock:abc123',
          atMs: 1_700_000_000_000,
        },
        {
          tradeId: 't_testnet',
          orderId: 'o_2',
          pair: 'bio.water/USDC',
          base: 'bio.water',
          quote: 'USDC',
          side: 'sell',
          makerSide: 'buy',
          amount: 20,
          notional: '20000000',
          platformFee: '0',
          stallFee: '0',
          stallFeeBp: 0,
          counterpartyKind: 'guild',
          state: 'FINAL',
          txHash: '5reiQL5XddxLS9hDDmKrh1Nn4N8f5Ui9KjtqySvGejok',
          atMs: 1_700_000_005_000,
        },
      ],
    };
    const host = document.createElement('div');
    renderFills(host, state);
    const links = [...host.querySelectorAll<HTMLAnchorElement>('[data-testid="fill-receipt"]')];
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('/dev/chain/tx/mock%3Aabc123');
    expect(links[1]?.getAttribute('href')).toBe(
      'https://testnet.nearblocks.io/txns/5reiQL5XddxLS9hDDmKrh1Nn4N8f5Ui9KjtqySvGejok',
    );
  });
});
