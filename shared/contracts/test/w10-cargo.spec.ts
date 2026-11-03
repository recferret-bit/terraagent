import { describe, expect, it } from 'vitest';
import {
  COMMAND_KINDS,
  EVENT_KINDS,
  NearCargoResponseSchema,
  REJECT_CODES,
  ServerMessage,
  cargoExportOpId,
  cargoImportOpId,
  commandDef,
  eventDef,
  parseCommandArgs,
  parseWaves,
  type CommandKind,
  type EventKind,
  type RejectCode,
} from '../src';

describe('W10-01 contracts: cargo commands, events, errors, status push, flag W10', () => {
  it('registers cargo.export, cargo.import, cargo.settled and dev commands on wave W10', () => {
    const cmds: CommandKind[] = [
      'cargo.export',
      'cargo.import',
      'cargo.settled',
      'dev.contactFake',
      'dev.tradehubSpawn',
      'dev.cargoCapReset',
      'dev.cargoGrant',
    ];
    for (const k of cmds) {
      expect(COMMAND_KINDS).toContain(k);
      expect(commandDef(k).wave).toBe('W10');
    }

    expect(parseCommandArgs('cargo.export', { colonyId: 'col_0', resource: 'metals.t1', amount: 300 }).success).toBe(true);
    expect(parseCommandArgs('cargo.export', { colonyId: 'col_0', resource: 'metals.t1', amount: 0 }).success).toBe(false);
    expect(parseCommandArgs('cargo.export', { colonyId: 'col_0', resource: 'metals.t1', amount: 10, extra: 1 }).success).toBe(false);
    expect(parseCommandArgs('cargo.import', { colonyId: 'col_0', resource: 'metals.t1', amount: 100 }).success).toBe(true);
    expect(
      parseCommandArgs('cargo.settled', {
        colonyId: 'col_0',
        ref: 'cargo-export:col_0:1',
        direction: 'export',
        resource: 'metals.t1',
        amount: 300,
        ok: true,
      }).success,
    ).toBe(true);
    expect(commandDef('cargo.settled').origin).toBe('module');
  });

  it('registers cargoExported, cargoImported, cargoRefunded on wave W10', () => {
    const events: EventKind[] = ['cargoExported', 'cargoImported', 'cargoRefunded'];
    for (const k of events) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W10');
    }
    const e1 = eventDef('cargoExported').data.parse({
      colonyId: 'col_0', ref: 'cargo-export:col_0:1', exportSeq: 1, resource: 'metals.t1', amount: 300,
    });
    expect(e1.exportSeq).toBe(1);
    const e2 = eventDef('cargoImported').data.parse({
      colonyId: 'col_0', ref: 'cargo-import:col_0:1', importSeq: 1, resource: 'metals.t1', amount: 100, phase: 'requested',
    });
    expect(e2.phase).toBe('requested');
    const e3 = eventDef('cargoRefunded').data.parse({
      colonyId: 'col_0', ref: 'cargo-export:col_0:1', direction: 'export', resource: 'metals.t1', amount: 300,
    });
    expect(e3.direction).toBe('export');
  });

  it('validates cargo.status WS push and GET /v1/near/cargo schema, opIds, and W10 error codes', () => {
    const payload = {
      colonyId: 'col_0',
      inOrbit: { 'metals.t1': 300 },
      pendingExport: [{ ref: 'cargo-export:col_0:1', seq: 1, resource: 'metals.t1' as const, amount: 50, direction: 'export' as const }],
      pendingImport: [],
      mintedToday: { 'metals.t1': 350 },
      mintCapPerDay: 20_000,
      throughputUsedPerMin: 350,
      throughputCapPerMin: 250,
      hubOnline: true,
      hubTier: 1,
      hubUnlocked: true,
    };
    expect(ServerMessage.parse({ v: 1, t: 'cargo.status', d: payload }).t).toBe('cargo.status');
    const rest = NearCargoResponseSchema.parse({ ...payload, colonies: { col_0: payload } });
    expect(rest.inOrbit['metals.t1']).toBe(300);
    expect(cargoExportOpId('col_0', 1)).toBe('cargo-export:col_0:1');
    expect(cargoImportOpId('col_0', 2)).toBe('cargo-import:col_0:2');
    const requiredErrors: RejectCode[] = ['mint_cap', 'insufficient_stock', 'insufficient_cargo', 'storage_full', 'hub_offline', 'no_trade_hub'];
    for (const code of requiredErrors) expect(REJECT_CODES).toContain(code);
    expect(parseWaves('..10').has('W10')).toBe(true);
    expect(parseWaves('..09').has('W10')).toBe(false);
  });
});
