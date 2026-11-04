import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData as compileDataWithFlags } from '../../src/data';

const compileData = (flags: { has(wave: string): boolean } = parseWaves('all')) =>
  compileDataWithFlags(flags);

describe('W07 combat stats in play', () => {
  const compiled = compileData();

  it('matches snapshot for HQ T1 auto-turret combat fields', () => {
    const hqCombat = {
      hp: compiled.tables.hq.t1.hp,
      radius: compiled.tables.hq.t1.radius,
      viewRadius: compiled.tables.hq.t1.viewRadius,
      dps: compiled.tables.hq.t1.dps,
      weaponRange: compiled.tables.hq.t1.weaponRange,
      selfPreservationHpRatio: compiled.tables.hq.t1.selfPreservationHpRatio,
      weapon: compiled.tables.weapons.hqAutoTurret,
    };
    expect(hqCombat).toMatchSnapshot();
  });

  it('matches snapshot for combatUnits table', () => {
    const {
      recon,
      roboticsFactory,
      droneControlArray,
      autocannon,
      laserTower,
      combatConfig,
    } = compiled.tables.combatUnits;
    expect({
      recon,
      roboticsFactory,
      droneControlArray,
      autocannon,
      laserTower,
      combatConfig,
    }).toMatchSnapshot();
  });

  it('matches snapshot for weapons table', () => {
    const {
      bullet,
      shell,
      rocket,
      laser,
      hqAutoTurret,
      reconGun,
      autocannon,
      laserTower,
      tankRocket,
      artilleryShell,
      antBite,
      beetleBite,
      spitterAcid,
    } = compiled.tables.weapons;
    expect({
      bullet,
      shell,
      rocket,
      laser,
      hqAutoTurret,
      reconGun,
      autocannon,
      laserTower,
      tankRocket,
      artilleryShell,
      antBite,
      beetleBite,
      spitterAcid,
    }).toMatchSnapshot();
  });

  it('matches snapshot for fauna table', () => {
    const {
      blackAnt,
      blueBeetle,
      greenSpitter,
      hiveBlackAnt,
      hiveBlueBeetle,
      hiveGreenSpitter,
      hiveConfig,
    } = compiled.tables.fauna;
    expect({
      blackAnt,
      blueBeetle,
      greenSpitter,
      hiveBlackAnt,
      hiveBlueBeetle,
      hiveGreenSpitter,
      hiveConfig,
    }).toMatchSnapshot();
  });
});

describe('W07 wave gating exclusion', () => {
  it('excludes all W07 rows when W07 is omitted from flags', () => {
    const compiledWithoutW07 = compileData(new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06']));
    expect(Object.keys(compiledWithoutW07.tables.combatUnits ?? {})).toHaveLength(0);
    expect(Object.keys(compiledWithoutW07.tables.weapons ?? {})).toHaveLength(0);
    expect(Object.keys(compiledWithoutW07.tables.fauna ?? {})).toHaveLength(0);
  });
});
