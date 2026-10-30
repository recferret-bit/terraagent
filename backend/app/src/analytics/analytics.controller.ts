import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AnalyticsBatchV1 } from '@terra/contracts';
import { CoreException } from '../core/errors';
import { ZodPipe } from '../core/errors/zod.pipe';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { AnalyticsService } from './analytics.service';

/** The slice of the Express request we use (express types are not a direct dependency). */
interface RawRequest extends AsyncIterable<Buffer> {
  is(type: string): string | false | null;
}

const MAX_BODY = 64 * 1024;

/** `sendBeacon(url, string)` posts `text/plain`, which the JSON body parser ignores: read the stream ourselves. */
async function readText(req: RawRequest): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new CoreException('PAYLOAD_TOO_LARGE', { status: 413, message: 'analytics batch too large' });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

@Controller('analytics')
export class AnalyticsController {
  private readonly pipe = new ZodPipe(AnalyticsBatchV1);
  constructor(private readonly svc: AnalyticsService, @Inject(APP_ENV) private readonly env: AppEnv) {}

  @Post('events')
  @HttpCode(204)
  async events(@Req() req: RawRequest, @Body() body: unknown): Promise<void> {
    if (this.env.ANALYTICS_DISABLED) return; // kill switch: accept and drop
    let raw = body;
    if (req.is('text/plain')) {
      try {
        raw = JSON.parse(await readText(req));
      } catch (e) {
        if (e instanceof CoreException) throw e;
        throw new CoreException('VALIDATION_ERROR', { status: 400, message: 'body is not valid JSON' });
      }
    }
    await this.svc.ingest(this.pipe.transform(raw));
  }
}
