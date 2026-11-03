import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CoreException, ZodPipe } from '../../core/errors/index.js';
import { DevOnlyGuard } from '../../core/dev-only.guard.js';
import { FlagsService } from '../../flags/flags.service.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { mockOauthSecret, signMockToken, MOCK_TOKEN_TTL_S } from './mock-token.js';

const TokenBody = z.object({
  provider: z.enum(['google', 'x']),
  subject: z.string().min(1).max(64),
  email: z.string().min(1).max(320).optional(),
});

/**
 * Dev-only mock OAuth (`POST /v1/dev/mock-oauth/token`). 404 in production (`DevOnlyGuard`), when the Identity
 * adapter is not `mock`, or when wave W06 is off.
 */
@Controller('dev/mock-oauth')
@UseGuards(DevOnlyGuard)
export class MockOauthController {
  private readonly pipe = new ZodPipe(TokenBody);

  constructor(private readonly flags: FlagsService) {}

  @Post('token')
  @HttpCode(200)
  token(@Body() raw: unknown): { token: string } {
    this.guard();
    const body = this.pipe.transform(raw);
    const exp = Math.floor(Date.now() / 1000) + MOCK_TOKEN_TTL_S;
    const claims = body.email === undefined
      ? { provider: body.provider, subject: body.subject, exp }
      : { provider: body.provider, subject: body.subject, email: body.email, exp };
    return { token: signMockToken(claims, mockOauthSecret()) };
  }

  /** 404 before zod, so a disabled route does not look like a validation error. */
  private guard(): void {
    if (nearAdapterFor('Identity', process.env) !== 'mock' || !this.flags.has('W06')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
  }
}
