import { Body, Controller, Get, Header, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../core/errors';
import { EconomyAuthGuard, RequireEconomyRole } from '../economy-auth';
import { ARTIFACT_NAME } from './experiment-artifacts';
import { ExperimentJobService } from './experiment-job.service';
import { ExperimentReportService } from './experiment-report.service';

const SubmitBody = z.strictObject({ requestId: z.string().min(1).max(120), manifest: z.unknown() });

/**
 * Experiment jobs API (ECONOMY §6/§8, W13-45): `edit` token to submit, cancel and resume (never the activate token's
 * role); `read` for status, results and artifacts. `POST` answers 202 with an id: completion is only ever read back.
 */
@Controller('economy/experiments')
@UseGuards(EconomyAuthGuard)
export class ExperimentController {
  constructor(private readonly jobs: ExperimentJobService) {}

  @Post() @HttpCode(202) @RequireEconomyRole('edit')
  submit(@Body(new ZodPipe(SubmitBody)) body: z.infer<typeof SubmitBody>) { return this.jobs.submit(body.manifest, body.requestId); }

  @Get() @RequireEconomyRole('read')
  async list() { return { experiments: await this.jobs.list() }; }

  @Get(':id') @RequireEconomyRole('read')
  status(@Param('id') id: string) { return this.jobs.status(id); }

  @Post(':id/cancel') @HttpCode(200) @RequireEconomyRole('edit')
  cancel(@Param('id') id: string) { return this.jobs.cancel(id); }

  @Post(':id/resume') @HttpCode(202) @RequireEconomyRole('edit')
  resume(@Param('id') id: string) { return this.jobs.resume(id); }

  @Get(':id/artifacts/:name') @RequireEconomyRole('read') @Header('cache-control', 'no-store')
  async artifact(@Param('id') id: string, @Param('name') name: string, @Res() res: { type(t: string): { send(b: string): void } }) {
    if (!ARTIFACT_NAME.test(name)) return res.type('text/plain').send('bad artifact name');
    const a = await this.jobs.artifact(id, name);
    return res.type(a.type).send(a.text);
  }
}

const CompareBody = z.strictObject({ baselineId: z.string().min(1).max(64), candidateId: z.string().min(1).max(64) });
const RecommendBody = z.strictObject({ experimentId: z.string().min(1).max(64), baselineId: z.string().min(1).max(64).optional() });

/** Paired comparison and candidate recommendation (W13-46). Read-only on the database; `recommend` never activates. */
@Controller('economy')
@UseGuards(EconomyAuthGuard)
export class ExperimentReportController {
  constructor(private readonly reports: ExperimentReportService) {}

  @Post('comparisons') @HttpCode(200) @RequireEconomyRole('read')
  compare(@Body(new ZodPipe(CompareBody)) b: z.infer<typeof CompareBody>) { return this.reports.compare(b.baselineId, b.candidateId); }

  @Post('recommendations') @HttpCode(200) @RequireEconomyRole('read')
  recommend(@Body(new ZodPipe(RecommendBody)) b: z.infer<typeof RecommendBody>) { return this.reports.recommend(b.experimentId, b.baselineId); }
}
