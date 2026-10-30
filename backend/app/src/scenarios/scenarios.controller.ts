import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { CoreException } from '../core/errors';
import { APP_ENV, type AppEnv } from '../core/tokens';
import { ScenariosService } from './scenarios.service';

/** `GET /v1/dev/scenarios`, `POST /v1/dev/scenarios/:id` → `{ planetId, scenario, tick }`. Dev only: 404 in production. */
@Controller('dev/scenarios')
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService, @Inject(APP_ENV) private readonly env: AppEnv) {}

  private guard(): void {
    if (this.env.NODE_ENV === 'production') throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }

  @Get()
  list() {
    this.guard();
    return { scenarios: this.scenarios.list() };
  }

  @Post(':id')
  @HttpCode(200)
  create(@Param('id') id: string) {
    this.guard();
    return this.scenarios.create(id);
  }
}
