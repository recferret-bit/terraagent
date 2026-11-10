import type { TreasuryProposalPush } from '@terra/contracts';

/** In-process council update. `WsGateway` broadcasts it as the `treasury.proposal` server message. */
export interface NearTreasuryProposalBusEvent {
  readonly planetId: string;
  readonly payload: TreasuryProposalPush;
}

declare module '../../bus/channels.js' {
  interface BusChannels {
    'near.treasury.proposal': NearTreasuryProposalBusEvent;
  }
}
