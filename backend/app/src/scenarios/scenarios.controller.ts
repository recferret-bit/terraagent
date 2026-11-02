import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../core/dev-only.guard';
import { ScenariosService } from './scenarios.service';

/** `GET /v1/dev/scenarios`, `POST /v1/dev/scenarios/:id` → `{ planetId, scenario, tick }`. Dev only: 404 in production. */
@Controller('dev/scenarios')
@UseGuards(DevOnlyGuard)
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  list() {
    return { scenarios: this.scenarios.list() };
  }

  @Post(':id')
  @HttpCode(200)
  create(@Param('id') id: string) {
    return this.scenarios.create(id);
  }
}
