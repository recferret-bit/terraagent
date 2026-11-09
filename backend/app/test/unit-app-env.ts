/** Unit HTTP fixtures may test production behavior without restoring or writing the developer's database. */
export const UNIT_APP_ENV = {
  SIM_THREADS: '1',
  SNAPSHOTS: 'off',
  OUTBOX_RELAY_ENABLED: 'false',
  PROGRESSION_WORKERS: 'off',
} as const;
