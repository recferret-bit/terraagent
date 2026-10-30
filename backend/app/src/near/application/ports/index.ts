import { AgentWalletPort } from './agent-wallet.port.js';
import { BadgeNftPort } from './badge-nft.port.js';
import { CargoTokenPort } from './cargo-token.port.js';
import { ChainReadPort } from './chain-read.port.js';
import { DeedNftPort } from './deed-nft.port.js';
import { EscrowPort } from './escrow.port.js';
import { IdentityPort } from './identity.port.js';
import { IntentsPort } from './intents.port.js';
import { RelayerPort } from './relayer.port.js';
import { StakingPort } from './staking.port.js';
import { TreasuryDaoPort } from './treasury-dao.port.js';
import { LlmProviderPort, NotifierPort } from '../../../ports/index.js';
import type { NearPortName } from '../../domain/types.js';

export * from './agent-wallet.port.js';
export * from './badge-nft.port.js';
export * from './cargo-token.port.js';
export * from './chain-read.port.js';
export * from './deed-nft.port.js';
export * from './escrow.port.js';
export * from './identity.port.js';
export * from './intents.port.js';
export * from './relayer.port.js';
export * from './staking.port.js';
export * from './treasury-dao.port.js';

export interface PortEntry { readonly name: NearPortName | 'LlmProvider' | 'Notifier'; readonly token: abstract new () => object }

/** All 13 ports, for the single binding module (near-infrastructure) and the app-level ports module. */
export const PORTS: readonly PortEntry[] = [
  { name: 'Identity', token: IdentityPort },
  { name: 'Relayer', token: RelayerPort },
  { name: 'CargoToken', token: CargoTokenPort },
  { name: 'Intents', token: IntentsPort },
  { name: 'AgentWallet', token: AgentWalletPort },
  { name: 'DeedNft', token: DeedNftPort },
  { name: 'BadgeNft', token: BadgeNftPort },
  { name: 'Staking', token: StakingPort },
  { name: 'TreasuryDao', token: TreasuryDaoPort },
  { name: 'Escrow', token: EscrowPort },
  { name: 'ChainRead', token: ChainReadPort },
  { name: 'LlmProvider', token: LlmProviderPort },
  { name: 'Notifier', token: NotifierPort },
];
