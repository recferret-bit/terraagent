import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** `@Body(new ZodPipe(Schema))`: parses with zod and returns the typed value; a failure throws a `ZodError` that the filter maps to 400 `VALIDATION_ERROR`. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.output<S> {
    return this.schema.parse(value);
  }
}
