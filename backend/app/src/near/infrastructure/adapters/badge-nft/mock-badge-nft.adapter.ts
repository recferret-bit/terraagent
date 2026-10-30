import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../../../ports/adapters';
import { BadgeNftPort } from '../../../application/ports/badge-nft.port';
import { BaseNep171MockAdapter } from '../../mock/nep171.base';

/** Mock badge NFTs: collection `badge`, state in Postgres through the shared NEP-171 base. */
@Injectable()
export class MockBadgeNftAdapter extends BaseNep171MockAdapter implements BadgeNftPort {
  protected readonly collection = 'badge';
  protected readonly portName = 'BadgeNft';
}

export const adapter = adapterOf({ port: BadgeNftPort, kind: 'mock', useClass: MockBadgeNftAdapter });
