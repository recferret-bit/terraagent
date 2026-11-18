import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query } from '@nestjs/common';
import { CoreException } from '../../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import {
  OneClickQuoteClient,
  type OneClickDryQuoteRequest,
  type OneClickDryQuoteResult,
  type OneClickTokenInfo,
} from '../adapters/real/oneclick-quote.service.js';

@Controller('near/intents')
export class IntentsRampController {
  private clientCache: OneClickQuoteClient | null = null;

  constructor(@Optional() @Inject(APP_ENV) private readonly env?: AppEnv) {}

  private client(): OneClickQuoteClient {
    if (!this.clientCache) {
      const source = (this.env ?? process.env) as Record<string, string | undefined>;
      this.clientCache = new OneClickQuoteClient(
        source.NEAR_ONECLICK_URL?.trim() || 'https://1click.chaindefuser.com',
        source.NEAR_ONECLICK_API_KEY?.trim() || undefined,
      );
    }
    return this.clientCache;
  }

  @Get('tokens')
  listTokens(): Promise<{
    readonly tokens: readonly OneClickTokenInfo[];
    readonly presets: readonly OneClickTokenInfo[];
  }> {
    return this.client().listWithPresets();
  }

  @Post('quote')
  @HttpCode(200)
  dryQuote(@Body() body: OneClickDryQuoteRequest): Promise<OneClickDryQuoteResult> {
    return this.client().dryQuote(body ?? {});
  }

  @Get('status')
  getStatus(@Query('depositAddress') depositAddress?: string) {
    const clean = (depositAddress ?? '').trim();
    if (!clean) {
      throw new CoreException('VALIDATION_ERROR', { status: 400, message: 'depositAddress is required' });
    }
    return this.client().getStatus(clean);
  }
}
