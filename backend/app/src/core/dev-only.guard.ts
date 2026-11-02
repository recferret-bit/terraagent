import { type CanActivate, Inject, Injectable } from '@nestjs/common';
import { CoreException } from './errors';
import { APP_ENV, type AppEnv } from './tokens';

/**
 * The one gate of every `/v1/dev/*` controller (BE-18): with `NODE_ENV=production` the route answers 404 as if it did
 * not exist. Apply it at controller level (`@UseGuards(DevOnlyGuard)`); `test/core/dev-routes.spec.ts` walks every
 * mapped `/v1/dev` route in production and fails on one that answers anything else.
 */
@Injectable()
export class DevOnlyGuard implements CanActivate {
  private readonly production: boolean;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.production = env.NODE_ENV === 'production';
  }

  canActivate(): boolean {
    if (this.production) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    return true;
  }
}
