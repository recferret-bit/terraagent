import { Module, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { APP_ENV } from '../core/tokens.js';
import type { AdapterDef } from './adapters.js';

export interface PortSlot {
  readonly name: string;
  readonly token: abstract new () => object;
  /** Selected adapter kind for this port, from the parsed env source (pure; see the `*-selection.ts` files). */
  readonly select: (env: Record<string, unknown>) => string;
}

/** Ports with no adapter at all stay unbound (later waves add them); a port with adapters but none of the selected kind fails boot. */
export function bindPorts(moduleName: string, slots: readonly PortSlot[], adapters: readonly AdapterDef[]) {
  const providers = slots.flatMap((slot) => {
    const mine = adapters.filter((a) => a.port === slot.token);
    if (!mine.length) return [];
    return [{
      provide: slot.token,
      inject: [APP_ENV, ModuleRef],
      useFactory: (env: Record<string, unknown>, ref: ModuleRef) => {
        const kind = slot.select(env);
        const adapter = mine.find((a) => a.kind === kind);
        if (!adapter) throw new Error(`${slot.name}: "${kind}" adapter selected but none is registered (have: ${mine.map((a) => a.kind).join(', ')})`);
        return ref.create(adapter.useClass as Type<object>);
      },
    }];
  });
  class Binding {}
  Object.defineProperty(Binding, 'name', { value: moduleName });
  Module({ providers, exports: providers.map((p) => p.provide) })(Binding);
  return Binding;
}
