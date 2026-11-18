import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ShadeAgentService } from './shade-agent.service.js';

@Controller('near/shade-agent')
export class ShadeAgentController {
  constructor(@Inject(ShadeAgentService) private readonly shade: ShadeAgentService) {}

  @Get('manifest')
  manifest() {
    return this.shade.manifest();
  }

  @Post('verify-attestation')
  @HttpCode(200)
  verifyAttestation(@Body() body: unknown) {
    return this.shade.verifyAttestation(body);
  }

  @Post('mpc-sign-request')
  @HttpCode(200)
  mpcSignRequest(@Body() body: unknown) {
    return this.shade.mpcSignRequest(body);
  }
}
