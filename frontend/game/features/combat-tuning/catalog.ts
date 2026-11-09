import { allTables, ENTITY_KIND, INSECT_WINDUP_TICKS, TICK_MS, type CompiledDataLike, type CompiledRow, type FaunaSpeciesId, type TableDef } from '@terra/sim';

export interface CombatTuneField {
  path: string;
  label: string;
  min: number;
  max: number;
  step: string;
  /** Multiplier reversing compileData's seconds/per-tick conversion. */
  designScale: number;
}
export interface CombatTuneType {
  id: string;
  label: string;
  kind?: number;
  fields: CombatTuneField[];
}

function field(table: TableDef, row: string, key: string, label: string, min = 0, max = 10000): CombatTuneField {
  const unit = table.units?.[key];
  const designScale = unit === 'perSecond' ? 1000 / TICK_MS : unit === 'seconds' ? TICK_MS / 1000 : 1;
  return { path: `${table.name}.${row}.${key}`, label, min, max, step: 'any', designScale };
}

function weaponFields(table: TableDef, rowId: string, row: CompiledRow): CombatTuneField[] {
  const specs: [string, string, number, number][] = [
    ['damage', 'Damage / hit', 0, 100000], ['ratePerS', 'Rate / second', 0, 5],
    ['range', 'Range · tiles', 1, 100], ['minRange', 'Minimum range · tiles', 0, 100],
    ['projSpeed', 'Projectile speed · tiles/s', 0.1, 200], ['aoe', 'Splash radius · tiles', 0, 50],
  ];
  return specs.filter(([key]) => typeof row[key] === 'number' && (key !== 'projSpeed' || Number(row[key]) > 0))
    .map(([key, label, min, max]) => field(table, rowId, key, label, min, max));
}

function entityFields(table: TableDef, row: CompiledRow, data: CompiledDataLike): CombatTuneField[] {
  const fields = [field(table, row.id, 'hp', 'Maximum health', 1, 100000)];
  for (const key of ['speed', 'speedTilesPerS', 'viewRadius']) {
    if (key === 'viewRadius' && typeof row.speed !== 'number' && typeof row.speedTilesPerS !== 'number') continue;
    if (typeof row[key] === 'number') fields.push(field(table, row.id, key, key === 'viewRadius' ? 'Sight · tiles' : 'Move speed · tiles/s', 0.1, 100));
  }
  if (table.name === 'fauna' && row.kind === 'species') {
    fields.push(field(table, row.id, 'damage', 'Damage / hit', 0, 100000));
    const minimumInterval = ((INSECT_WINDUP_TICKS[row.id as FaunaSpeciesId] ?? 3) + 2) * TICK_MS / 1000;
    fields.push({ ...field(table, row.id, 'attackIntervalS', 'Attack interval · seconds', minimumInterval, 20), step: String(TICK_MS / 1000) });
    fields.push(field(table, row.id, 'range', 'Range · tiles', 1, 100));
    if (Number(row.projSpeed) > 0) fields.push(field(table, row.id, 'projSpeed', 'Projectile speed · tiles/s', 0.1, 200));
  } else {
    const id = table.name === 'hq' ? 'hqAutoTurret' : row.weaponId;
    const weapons = data.tables.weapons as Record<string, CompiledRow> | undefined;
    const definition = allTables().find(t => t.name === 'weapons');
    if (typeof id === 'string' && weapons?.[id] && definition) fields.push(...weaponFields(definition, id, weapons[id]));
  }
  return fields;
}

/** Presentation metadata only: every value is read from the current host's compiled data. */
export function combatTuneTypes(data: CompiledDataLike): CombatTuneType[] {
  const types: CombatTuneType[] = [];
  for (const table of allTables()) {
    const rows = data.tables[table.name] as Record<string, CompiledRow> | undefined;
    for (const row of Object.values(rows ?? {})) {
      if (typeof row.hp !== 'number') continue;
      const name = table.name === 'hq' ? 'hq' : table.name === 'hub' ? 'commandHub' : String(row.unit ?? row.building ?? row.id);
      const label = typeof row.label === 'string' ? row.label : name === 'hq' ? 'HQ Commander' : name === 'commandHub' ? 'Command Hub' : name;
      types.push({ id: `${table.name}.${row.id}`, label: `${label}${Number(row.tier) > 1 ? ` T${row.tier}` : ''}`,
        kind: ENTITY_KIND[name as keyof typeof ENTITY_KIND], fields: entityFields(table, row, data) });
    }
  }
  const weapons = allTables().find(t => t.name === 'weapons')!;
  for (const [id, label] of [['tankRocket', 'Demo Tank · weapon'], ['artilleryShell', 'Demo Artillery · weapon']]) {
    const row = (data.tables.weapons as Record<string, CompiledRow> | undefined)?.[id];
    if (row) types.push({ id: `weapons.${id}`, label, fields: weaponFields(weapons, id, row) });
  }
  return types.sort((a, b) => a.label.localeCompare(b.label));
}

export function readTuneValue(data: CompiledDataLike, f: CombatTuneField): number {
  const [table, row, key] = f.path.split('.');
  const value = Number((data.tables[table] as Record<string, CompiledRow> | undefined)?.[row]?.[key]) * f.designScale;
  return value;
}

export function tuneDesignValue(f: CombatTuneField, raw: string): number {
  const value = raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < f.min || value > f.max) throw new Error(`${f.label} must be ${f.min}–${f.max}.`);
  if (f.step !== 'any' && Math.abs(value / Number(f.step) - Math.round(value / Number(f.step))) > 1e-6) {
    throw new Error(`${f.label} must use steps of ${f.step}.`);
  }
  return value;
}

export function validateTuneRange(data: CompiledDataLike | null | undefined, field: CombatTuneField, value: number): void {
  const [table, row, key] = field.path.split('.');
  const current = (data?.tables[table] as Record<string, CompiledRow> | undefined)?.[row];
  if (key === 'range' && value < Number(current?.minRange ?? 0)) throw new Error('Range cannot be below the current minimum range.');
  if (key === 'minRange' && value > Number(current?.range ?? Infinity)) throw new Error('Minimum range cannot exceed the current range.');
}
