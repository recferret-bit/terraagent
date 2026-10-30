import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

/** Routes Nest's own logs through pino (`app.useLogger`). Context becomes `ctx`. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly pino: Logger) {}
  private emit(level: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal', msg: unknown, params: unknown[]) {
    const last = params[params.length - 1];
    const ctx = typeof last === 'string' ? last : undefined;
    const extra = ctx === undefined ? params : params.slice(0, -1);
    const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const bindings = { ...(ctx ? { ctx } : {}), ...(level === 'error' && extra.length ? { trace: extra[0] } : {}) };
    this.pino[level](bindings, text);
  }
  log(msg: unknown, ...p: unknown[]) { this.emit('info', msg, p); }
  error(msg: unknown, ...p: unknown[]) { this.emit('error', msg, p); }
  warn(msg: unknown, ...p: unknown[]) { this.emit('warn', msg, p); }
  debug(msg: unknown, ...p: unknown[]) { this.emit('debug', msg, p); }
  verbose(msg: unknown, ...p: unknown[]) { this.emit('trace', msg, p); }
  fatal(msg: unknown, ...p: unknown[]) { this.emit('fatal', msg, p); }
}
