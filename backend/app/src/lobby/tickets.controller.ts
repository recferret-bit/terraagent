import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { MatchTicketV1 } from '@terra/contracts';
import {
  BearerAuthGuard,
  CurrentPlayer,
  type AuthenticatedPlayer,
  type AuthenticatedRequest,
} from '../core/auth/bearer-auth.guard';
import { normalizePlayerId } from './tickets.helpers';
import { MatchTicketsService } from './tickets.service';
import { MatchTicketsExceptionFilter } from './tickets.types';

function readHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  headerName: string,
): string | undefined {
  if (!headers) return undefined;
  const direct = headers[headerName] ?? headers[headerName.toLowerCase()];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (Array.isArray(direct) && typeof direct[0] === 'string' && direct[0].trim()) return direct[0].trim();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === headerName.toLowerCase());
  if (!key) return undefined;
  const val = headers[key];
  if (typeof val === 'string' && val.trim()) return val.trim();
  if (Array.isArray(val) && typeof val[0] === 'string' && val[0].trim()) return val[0].trim();
  return undefined;
}

function resolveAuthenticatedPlayerId(
  playerArg?: AuthenticatedPlayer | string,
  reqArg?: AuthenticatedRequest & { playerId?: string },
): string {
  const fromPlayer = normalizePlayerId(playerArg);
  if (fromPlayer) return fromPlayer;
  const fromReqPlayer = normalizePlayerId(reqArg?.player);
  if (fromReqPlayer) return fromReqPlayer;
  if (typeof reqArg?.playerId === 'string' && reqArg.playerId.trim()) {
    return reqArg.playerId.trim();
  }
  throw new UnauthorizedException('Unauthenticated request');
}

/**
 * Matchmaking tickets REST controller (`/v1/match/tickets`, W11-10, MATCHMAKING §0.2, §0.3, §5).
 */
@Controller('match/tickets')
@UseGuards(BearerAuthGuard)
@UseFilters(MatchTicketsExceptionFilter)
export class MatchTicketsController {
  constructor(@Inject(MatchTicketsService) private readonly ticketsService: MatchTicketsService) {}

  @Post()
  @HttpCode(200)
  async enqueueTicket(
    @Body() body: unknown,
    @CurrentPlayer() player?: AuthenticatedPlayer | string,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
    @Req() req?: AuthenticatedRequest & { headers?: Record<string, string | string[] | undefined> },
  ): Promise<MatchTicketV1> {
    const playerId = resolveAuthenticatedPlayerId(player, req);
    const idempotencyKey =
      (typeof idempotencyKeyHeader === 'string' && idempotencyKeyHeader.trim()
        ? idempotencyKeyHeader.trim()
        : undefined) ??
      readHeaderValue(req?.headers, 'idempotency-key') ??
      readHeaderValue(req?.headers, 'x-idempotency-key');

    return this.ticketsService.enqueueTicket(playerId, body as Record<string, unknown>, {
      idempotencyKey,
    });
  }

  @Get('current')
  async getCurrentTicket(
    @CurrentPlayer() player?: AuthenticatedPlayer | string,
    @Req() req?: AuthenticatedRequest,
  ): Promise<MatchTicketV1> {
    const playerId = resolveAuthenticatedPlayerId(player, req);
    return this.ticketsService.getTicket('current', playerId);
  }

  @Get(':id')
  async getTicket(
    @Param('id') id: string,
    @CurrentPlayer() player?: AuthenticatedPlayer | string,
    @Req() req?: AuthenticatedRequest,
  ): Promise<MatchTicketV1> {
    const playerId = resolveAuthenticatedPlayerId(player, req);
    return this.ticketsService.getTicket(id, playerId);
  }

  @Delete('current')
  @HttpCode(200)
  async cancelCurrentTicket(
    @CurrentPlayer() player?: AuthenticatedPlayer | string,
    @Req() req?: AuthenticatedRequest,
  ): Promise<MatchTicketV1> {
    const playerId = resolveAuthenticatedPlayerId(player, req);
    return this.ticketsService.cancelTicket('current', playerId);
  }

  @Delete(':id')
  @HttpCode(200)
  async cancelTicket(
    @Param('id') id: string,
    @CurrentPlayer() player?: AuthenticatedPlayer | string,
    @Req() req?: AuthenticatedRequest,
  ): Promise<MatchTicketV1> {
    const playerId = resolveAuthenticatedPlayerId(player, req);
    return this.ticketsService.cancelTicket(id, playerId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancelTicketPost(
    @Param('id') id: string,
    @CurrentPlayer() player?: AuthenticatedPlayer | string,
    @Req() req?: AuthenticatedRequest,
  ): Promise<MatchTicketV1> {
    const playerId = resolveAuthenticatedPlayerId(player, req);
    return this.ticketsService.cancelTicket(id, playerId);
  }
}
