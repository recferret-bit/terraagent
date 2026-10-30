import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CoreException } from '../core/errors/index.js';
import { DevCommandRegistry } from './dev-command.registry.js';

/** `GET /v1/dev/commands`, `POST /v1/dev/commands/:name` (body = args). 404 in production. */
@Controller('dev/commands')
export class DevController {
  constructor(private readonly registry: DevCommandRegistry) {}

  private guard(): void {
    if (!this.registry.enabled) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }

  @Get()
  list() {
    this.guard();
    return { commands: this.registry.list() };
  }

  @Post(':name')
  @HttpCode(200)
  async run(@Param('name') name: string, @Body() body: unknown) {
    this.guard();
    return this.registry.run(name, body);
  }
}
