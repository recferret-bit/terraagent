import { CANONICAL_PLANETS, W11_SEVEN_SECTOR_COORDS, deriveWorldAvailability, formatSectorId, type PlanetSummaryV1 } from '@terra/contracts';
import { PLANET_KINDS, PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import { describe, expect, it } from 'vitest';
import { buildOrbitalGlobeMarkers, getSectorSphereAngle, HEX_OUTER_ANGULAR_RADIUS, resolveHomeBaseSectorId, resolveSectorPopulationMap, sampleGlobeLandHeight, sphericalSectorAngle } from './sectorGlobeMap';

function makeOceanSummary(): PlanetSummaryV1 {
  const def = CANONICAL_PLANETS.ocean;
  const now = '2026-11-18T12:00:00.000Z';
  const sectors = W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) => ({
    sectorId: formatSectorId(mq, mr),
    continentId: 'cont_0',
    macroQ: mq,
    macroR: mr,
    centerQ: mq * 37,
    centerR: mr * 37,
    kind: 'land' as const,
    foundingCapacity: 4,
    validatedCapacity: 4,
    reservedSeats: 0,
    foundedSeats: mq === 0 && mr === 0 ? 1 : 0,
    freeSeats: mq === 0 && mr === 0 ? 3 : 4,
    livingColonies: mq === 0 && mr === 0 ? 1 : 0,
    presentColonies: mq === 0 && mr === 0 ? 1 : 0,
    onlinePlayers: 0,
    availability: 'open' as const,
    mainResource: 'bio.water' as const,
  }));
  return {
    id: def.id,
    name: def.name,
    type: 'ocean',
    look: def.look,
    lifecycle: 'ACTIVE',
    health: 'OK',
    admission: 'OPEN',
    availability: deriveWorldAvailability({ lifecycle: 'ACTIVE', health: 'OK', admission: 'OPEN', freeSeats: 27 }),
    atlasVersion: 1,
    atlasHash: 'atlas_ocean',
    configHash: 'cfg_ocean',
    totalSectors: 7,
    landSectors: 7,
    oceanSectors: 0,
    nominalCapacity: 28,
    validatedCapacity: 28,
    reservedSeats: 0,
    foundedSeats: 1,
    freeSeats: 27,
    livingColonies: 3,
    presentColonies: 3,
    onlinePlayers: 1,
    playerColonies: 1,
    botColonies: 2,
    updatedAt: now,
    sectors,
    colonies: [
      { colonyId: 'co_home_1', displayName: 'Atoll Alpha', foundingSectorId: 'sec_0_0', foundedAt: now },
      { colonyId: 'col_bot_1', displayName: 'Tide Bot', foundingSectorId: 'sec_1_0', foundedAt: now, isBot: true },
    ],
  };
}

describe('sectorGlobeMap continent placement, home base pinning & sector distribution', () => {
  it('places all 7 sectors on continent land across ocean, temperate, and desert planets', () => {
    for (const kind of PLANET_KINDS) {
      const seaLevel = PLANET_SPECS[kind].orbital.seaLevel;
      for (const [mq, mr] of W11_SEVEN_SECTOR_COORDS) {
        const sid = formatSectorId(mq, mr);
        const pos = getSectorSphereAngle(sid, 0, kind);
        const h = sampleGlobeLandHeight(kind, pos.yaw, pos.pitch, 0);
        expect(h).toBeGreaterThanOrEqual(seaLevel);
      }
      const angles = W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) => getSectorSphereAngle(formatSectorId(mq, mr), 0, kind));
      for (let i = 0; i < angles.length; i++) {
        for (let j = i + 1; j < angles.length; j++) {
          expect(sphericalSectorAngle(angles[i]!, angles[j]!)).toBeGreaterThanOrEqual(2 * HEX_OUTER_ANGULAR_RADIUS + 0.015);
        }
      }
    }
  });

  it('keeps active home base pinned to the exact same sector when selecting different target sectors', () => {
    const summary = makeOceanSummary();
    expect(resolveHomeBaseSectorId(summary, null)).toBe('sec_0_0');

    for (const targetSec of ['sec_0_0', 'sec_1_0', 'sec_-1_1']) {
      const markers = buildOrbitalGlobeMarkers(summary, { mode: 'chosen', sectorId: targetSec }, null, 'oceanForest');
      expect(markers).toHaveLength(7);
      expect(markers.filter((m) => m.isHomeBase).map((m) => m.id)).toEqual(['sec_0_0']);
      expect(markers.find((m) => m.id === targetSec)?.role).toBe('target');
    }

    const popMap = resolveSectorPopulationMap(summary);
    let totalP = 0;
    let totalB = 0;
    for (const p of popMap.values()) {
      totalP += p.players;
      totalB += p.bots;
    }
    expect(totalP).toBe(1);
    expect(totalB).toBe(2);
  });
});
