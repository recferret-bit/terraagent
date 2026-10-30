import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { CoreException } from '../../../../../src/core/errors/core-exception';
import { ZodPipe } from '../../../../../src/core/errors/zod.pipe';

const Dto = z.object({ name: z.string().min(1), password: z.string().optional() });

@Controller('_test')
class ErrProbeController {
  @Get('throw')
  throwCore(): never {
    throw new CoreException('TEST_CODE', { status: 418, message: 'teapot', details: { a: 1 } });
  }
  @Get('boom')
  boom(): never {
    throw new Error('secret database password leaked');
  }
  @Get('prisma')
  prisma(): never {
    throw Object.assign(new Error('Unique constraint'), { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['email'] } });
  }
  @Post('dto')
  dto(@Body(new ZodPipe(Dto)) body: z.infer<typeof Dto>) {
    return { ok: true, name: body.name };
  }
}

@Module({ controllers: [ErrProbeController] })
export class ErrProbeModule {}
