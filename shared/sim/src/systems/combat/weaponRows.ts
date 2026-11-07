import { compileData, type CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import { resolveSpeciesConfig, speciesOfEntityKind } from '../fauna/types';

const W07_WAVE_SET = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);
let cachedW07Data: CompiledDataLike | null = null;

function defaultW07Data(): CompiledDataLike {
  if (!cachedW07Data) cachedW07Data = compileData(W07_WAVE_SET);
  return cachedW07Data;
}

const WEAPON_ID_ALIASES: Readonly<Record<string, string>> = {
  lightLaser: 'reconGun',
  pulsedLaser: 'laserTower',
  mandibleBite: 'antBite',
  hornGore: 'beetleBite',
  spitterGlob: 'spitterAcid',
  artillery: 'artilleryShell',
  demoArtillery: 'artilleryShell',
  tank: 'tankRocket',
  demoTank: 'tankRocket',
};

const KIND_TO_WEAPON_ID: Readonly<Record<number, string>> = {
  [ENTITY_KIND.hq]: 'hqAutoTurret',
  [ENTITY_KIND.recon]: 'reconGun',
  [ENTITY_KIND.demoTank]: 'tankRocket',
  [ENTITY_KIND.demoArtillery]: 'artilleryShell',
  [ENTITY_KIND.autocannon]: 'autocannon',
  [ENTITY_KIND.laserTower]: 'laserTower',
  [ENTITY_KIND.blackAnt]: 'antBite',
  [ENTITY_KIND.blueBeetle]: 'beetleBite',
  [ENTITY_KIND.greenSpitter]: 'spitterAcid',
};

export function lookupWeaponById(
  data: CompiledDataLike | undefined,
  rawId: string,
): CompiledRow | undefined {
  const canonicalId = WEAPON_ID_ALIASES[rawId] ?? rawId;
  const fallback = defaultW07Data();
  const primaryTable = data?.tables?.weapons as Readonly<Record<string, CompiledRow | undefined>> | undefined;
  const fallbackTable = fallback.tables.weapons as Readonly<Record<string, CompiledRow | undefined>> | undefined;
  return (
    primaryTable?.[rawId] ??
    primaryTable?.[canonicalId] ??
    fallbackTable?.[rawId] ??
    fallbackTable?.[canonicalId]
  );
}

/** Canonical weapon stats shared by combat, movement approach and client previews. */
export function resolveKindWeaponRow(kind: number, data?: CompiledDataLike): CompiledRow | undefined {
  const id = KIND_TO_WEAPON_ID[kind];
  if (!id) return undefined;
  const weapon = lookupWeaponById(data, id);
  const species = speciesOfEntityKind(kind);
  if (!species || !weapon) return weapon;
  const cfg = resolveSpeciesConfig(species, data);
  return { ...weapon, damage: cfg.damage, range: cfg.range, projSpeed: cfg.projSpeed,
    ratePerS: TICKS_PER_SECOND / cfg.attackIntervalTicks, dps: cfg.damage * TICKS_PER_SECOND / cfg.attackIntervalTicks };
}
