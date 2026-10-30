// The tests boot only the core module so other modules (db, game, ...) and their env/Postgres needs stay out.
export * from '../../../../../src/core/core.module';
