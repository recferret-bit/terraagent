import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  IdentityPort,
  type ClaimAccountInput,
  type CreateNamedAccountInput,
  type CreateNamedAccountResult,
  type SocialLoginInput,
  type SocialLoginResult,
} from '../../../application/ports/identity.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { mockOauthSecret, verifyMockToken } from '../../../identity/mock-token.js';

/** Mock social login: HMAC token check only. Named accounts and wallet claim belong to later waves. */
@Injectable()
export class MockIdentityAdapter implements IdentityPort {
  async loginSocial(input: SocialLoginInput): Promise<SocialLoginResult> {
    const claims = verifyMockToken(input.token, mockOauthSecret(), Date.now());
    if (claims.provider !== input.provider) throw new NearException('NEAR_PROVIDER_REJECTED');
    return { playerId: claims.subject, email: claims.email ?? null, isNew: true };
  }

  createNamedAccount(_input: CreateNamedAccountInput): Promise<CreateNamedAccountResult> {
    return this.unavailable();
  }

  claimAccount(_input: ClaimAccountInput): Promise<ChainReceipt> {
    return this.unavailable();
  }

  private unavailable(): never {
    throw new NearException('NEAR_UNAVAILABLE', { message: 'not implemented' });
  }
}

export const adapter = adapterOf({ port: IdentityPort, kind: 'mock', useClass: MockIdentityAdapter });
