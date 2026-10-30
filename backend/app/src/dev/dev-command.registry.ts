import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CoreException } from '../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';

/** A named server dev command; `args` validates the request body (a zod failure is a 400 `VALIDATION_ERROR`). */
export interface DevCommand<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly help: string;
  readonly args: S;
  run(args: z.output<S>): unknown | Promise<unknown>;
}

export const defineDevCommand = <S extends z.ZodType>(c: DevCommand<S>): DevCommand<S> => c;

/** Global registry: server modules call `register` (usually in `onModuleInit`). Disabled, and a no-op, in production. */
@Injectable()
export class DevCommandRegistry {
  private readonly commands = new Map<string, DevCommand>();
  readonly enabled: boolean;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.enabled = env.NODE_ENV !== 'production';
  }

  register(cmd: DevCommand): void {
    if (!this.enabled) return;
    if (this.commands.has(cmd.name)) throw new Error(`dev command "${cmd.name}" is already registered`);
    this.commands.set(cmd.name, cmd);
  }

  list(): { name: string; help: string }[] {
    return [...this.commands.values()].map(({ name, help }) => ({ name, help })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async run(name: string, body: unknown): Promise<unknown> {
    const cmd = this.commands.get(name);
    if (!cmd) throw new CoreException('NOT_FOUND', { status: 404, message: `Unknown dev command "${name}"` });
    return cmd.run(cmd.args.parse(body ?? {}));
  }
}
