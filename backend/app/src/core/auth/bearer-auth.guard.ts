import {
  CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AuthTokenService } from './auth-token.service';

export interface AuthenticatedPlayer {
  readonly id: string;
  readonly handle: string;
}

export type AuthenticatedRequest = IncomingMessage & {
  player?: AuthenticatedPlayer;
};

const BEARER_RE = /^Bearer\s+(\S+)$/i;

export function extractBearerPlayer(
  req: { headers?: Record<string, string | string[] | undefined>; player?: AuthenticatedPlayer },
  tokenService: AuthTokenService,
): AuthenticatedPlayer {
  const raw = req.headers?.authorization ?? req.headers?.Authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') {
    throw new UnauthorizedException('Missing Authorization Bearer header');
  }
  const match = BEARER_RE.exec(header.trim());
  if (!match || !match[1]) {
    throw new UnauthorizedException('Malformed Authorization Bearer header');
  }
  const verified = tokenService.verifyAccessToken(match[1]);
  const player: AuthenticatedPlayer = { id: verified.sub, handle: verified.handle };
  req.player = player;
  return player;
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private readonly tokenService: AuthTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    extractBearerPlayer(req, this.tokenService);
    return true;
  }
}

export const CurrentPlayer = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedPlayer => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.player) {
    throw new UnauthorizedException('Unauthenticated request');
  }
  return req.player;
});
