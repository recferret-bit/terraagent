import { el } from '../../../dom';

export const connectCtaLabel = (amount: number): string => `Connect NEAR Wallet to Stake ${amount} NEAR`;

/** Primary orange CTA; `onConnect` starts the existing NEAR wallet sign-in flow (PilotAccess dialog). */
export function renderConnectCta(amount: number, onConnect: () => void): HTMLElement {
  return el(
    'button',
    {
      className: 'btn btn-primary ta-stk-cta',
      type: 'button',
      dataset: { testid: 'staking-connect-cta', amount },
      onClick: onConnect,
    },
    connectCtaLabel(amount),
  );
}
