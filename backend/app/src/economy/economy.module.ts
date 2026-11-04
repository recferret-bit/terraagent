import { Module } from '@nestjs/common';

/**
 * W13 economy management (D-44, ECONOMY §5–§8): parameter registry/schema, database profiles and versions,
 * compile/hash, activation/rollback, experiments and the operator API. Pure economy calculations live in
 * `shared/sim/src/economy/`; DB tables in `shared/db/prisma/economy.prisma` (W13-37).
 */
@Module({ providers: [], controllers: [], imports: [], exports: [] })
export class EconomyModule {}
