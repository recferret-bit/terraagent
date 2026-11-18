import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { buildAgentMarketManifest } from './agent-market.manifest.js';
import { McpService, type McpJsonRpcResponse } from './mcp.service.js';

const SAFE_HOST_RE = /^[A-Za-z0-9.:[\]-]{1,128}$/;

@Controller('mcp')
export class McpController {
  constructor(@Inject(McpService) private readonly mcp: McpService) {}

  @Get('agent-market.json')
  manifest(@Req() req: IncomingMessage) {
    const rawHost = String(req.headers?.host ?? '').trim();
    const hostHeader = SAFE_HOST_RE.test(rawHost) ? rawHost : '127.0.0.1:3000';
    const rawProto = String(req.headers?.['x-forwarded-proto'] ?? 'https').split(',')[0]?.trim().toLowerCase();
    const proto = rawProto === 'http' ? 'http' : 'https';
    return buildAgentMarketManifest(`${proto}://${hostHeader}`);
  }

  @Post()
  @HttpCode(200)
  rpc(
    @Req() req: IncomingMessage,
    @Body() body: unknown,
    @Query('as') as?: string,
  ): Promise<McpJsonRpcResponse> {
    return this.mcp.handleJsonRpc(req, body, as);
  }
}
