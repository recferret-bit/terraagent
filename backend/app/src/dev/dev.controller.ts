import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { DevOnlyGuard } from '../core/dev-only.guard.js';
import { DevCommandRegistry } from './dev-command.registry.js';

/** `GET /v1/dev/commands`, `POST /v1/dev/commands/:name` (body = args). 404 in production. */
@Controller('dev/commands')
@UseGuards(DevOnlyGuard)
export class DevController {
  constructor(private readonly registry: DevCommandRegistry) {}

  @Get()
  list() {
    return { commands: this.registry.list() };
  }

  @Post(':name')
  @HttpCode(200)
  async run(@Param('name') name: string, @Body() body: unknown) {
    return this.registry.run(name, body);
  }
}
