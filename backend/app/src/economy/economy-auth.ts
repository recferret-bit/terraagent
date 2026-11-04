import { timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CoreException } from '../core/errors';
import { APP_ENV, type AppEnv } from '../core/tokens';

/**
 * Economy management permissions (ECONOMY §5): `read` (schema, profiles, exports, results) and `edit` (clone, patch,
 * validate candidates). `activate` is a separate operator permission that arrives with W13-39; an AI credential never has it.
 */
export type EconomyRole = 'read' | 'edit';
export const ECONOMY_ROLE_KEY = 'economy:role';
/** `@EconomyRole('edit')` on a route; the guard requires it. */
export const RequireEconomyRole = (role: EconomyRole) => SetMetadata(ECONOMY_ROLE_KEY, role);

/** Dev-only default credentials; production never has defaults (a role without a configured token is unavailable). */
export const DEV_ECONOMY_READ_TOKEN = 'dev-economy-reader';
export const DEV_ECONOMY_EDIT_TOKEN = 'dev-economy-operator';

export interface EconomyPrincipal { readonly role: EconomyRole; readonly actor: string }
export type EconomyRequest = { headers?: Record<string, string | string[] | undefined>; economy?: EconomyPrincipal };

const safeEq = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Bearer-token guard: read token grants `read`; edit token grants `edit` and `read`. 401 without a valid token, 403 for a missing role. */
@Injectable()
export class EconomyAuthGuard implements CanActivate {
  private readonly readToken: string | undefined;
  private readonly editToken: string | undefined;

  constructor(@Inject(APP_ENV) env: AppEnv, private readonly reflector: Reflector) {
    const prod = env.NODE_ENV === 'production';
    this.readToken = (env.TA_ECONOMY_READ_TOKEN as string | undefined) ?? (prod ? undefined : DEV_ECONOMY_READ_TOKEN);
    this.editToken = (env.TA_ECONOMY_EDIT_TOKEN as string | undefined) ?? (prod ? undefined : DEV_ECONOMY_EDIT_TOKEN);
  }

  canActivate(context: ExecutionContext): boolean {
    const need = this.reflector.getAllAndOverride<EconomyRole | undefined>(ECONOMY_ROLE_KEY, [context.getHandler(), context.getClass()]) ?? 'edit';
    const req = context.switchToHttp().getRequest<EconomyRequest>();
    const raw = req.headers?.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    const token = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] : undefined;
    if (!token) throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Missing Authorization Bearer token' });
    const role: EconomyRole | undefined = this.editToken && safeEq(token, this.editToken) ? 'edit' : this.readToken && safeEq(token, this.readToken) ? 'read' : undefined;
    if (!role) throw new CoreException('UNAUTHORIZED', { status: 401, message: 'Invalid economy token' });
    if (need === 'edit' && role !== 'edit') throw new CoreException('FORBIDDEN', { status: 403, message: 'This token cannot edit economy candidates' });
    const label = req.headers?.['x-economy-actor'];
    const who = (Array.isArray(label) ? label[0] : label)?.replace(/[^\w.@-]/g, '').slice(0, 60);
    req.economy = { role, actor: who ? `${role}:${who}` : role };
    return true;
  }
}
