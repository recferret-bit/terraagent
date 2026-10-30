import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable() class A { name() { return 'A'; } }
@Injectable() class B { constructor(readonly a: A) {} }
@Module({ providers: [A, B] }) class M {}

// Guards the toolchain choice: constructor injection by type needs emitDecoratorMetadata (SWC, not esbuild).
describe('nest DI under vitest', () => {
  it('injects by type', async () => {
    const mod = await Test.createTestingModule({ imports: [M] }).compile();
    expect(mod.get(B).a.name()).toBe('A');
  });
});
