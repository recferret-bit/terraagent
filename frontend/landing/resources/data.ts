// The five landing resources: which kitbash archetype shows them and the technical sheet beside it.
import type { PlanetKind } from '@shared/engine/planets/PlanetSpec';

export interface ResourceInfo {
  archetype: string; biome: PlanetKind; symbol: string; name: string;
  science: string; specs: [string, string][]; game: string;
}

export const RES: Record<string, ResourceInfo> = {
  metals: {
    archetype: 'resource.metalDeposit', biome: 'dune', symbol: 'Fe · Al · Cu', name: 'Metals',
    science: 'Metal-bearing rock: iron oxides such as hematite (Fe₂O₃) and magnetite (Fe₃O₄), plus aluminium and copper ores. A reducing furnace strips the oxygen out. Exposed veins weather rust-red because iron oxidises on contact with air.',
    specs: [['Key ores', 'Hematite · Magnetite · Bauxite'], ['Iron density', '7.87 g/cm³'], ['Iron melts at', '1,538 °C'], ['Processing', 'Reduction smelting']],
    game: 'Mined by the Mine (2×2). Spent on robots, buildings, rockets and ammo.',
  },
  minerals: {
    archetype: 'resource.crystalDeposit', biome: 'forestRock', symbol: 'SiO₂', name: 'Minerals',
    science: 'Crystalline silicates and oxides. Quartz (SiO₂) is the feedstock for silicon wafers, and its lattice is piezoelectric, so it also keeps time in oscillators. Rare-earth minerals supply the dopants electronics need. In the game, cyan glow marks a high-purity deposit.',
    specs: [['Key phases', 'Quartz · Feldspar · Monazite'], ['Quartz hardness', '7 Mohs'], ['Quartz density', '2.65 g/cm³'], ['Quartz melts at', '≈ 1,713 °C']],
    game: 'Refined into advanced parts and electronics.',
  },
  petroleum: {
    archetype: 'resource.oilDeposit', biome: 'dune', symbol: 'CₙH₂ₙ₊₂', name: 'Petroleum',
    science: 'Crude oil is a mixture of hydrocarbons, mostly alkanes, formed from buried organic matter. Fractional distillation separates it by boiling point into gases, gasoline, kerosene, diesel and heavy residue. Cracking breaks the same molecules into the building blocks of plastics.',
    specs: [['Composition', '83–87 % C · 10–14 % H'], ['Density', '0.80–0.95 g/cm³'], ['Boiling range', '30 °C to over 500 °C'], ['Energy content', '≈ 42–46 MJ/kg']],
    game: 'Burned as fuel, polymerised into plastics, and used for some power.',
  },
  water: {
    archetype: 'building.waterPump', biome: 'oceanForest', symbol: 'H₂O', name: 'Water',
    science: 'A polar molecule whose hydrogen bonds give it an unusually high heat capacity, which makes it the standard coolant. Density peaks at 4 °C, which is why ice floats. Electrolysis splits it into hydrogen and oxygen, and plants turn it into biomass.',
    specs: [['Density', '1.000 g/cm³ at 4 °C'], ['Specific heat', '4.18 J/(g·K)'], ['Boils at', '100 °C at 1 atm'], ['Latent heat', '2,257 kJ/kg (vaporisation)']],
    game: 'Drawn by the Water Pump (1×1). Used for cooling, terraforming and biology.',
  },
  energy: {
    archetype: 'building.solar', biome: 'dune', symbol: 'W = J/s', name: 'Energy',
    science: 'Electrical power, measured in watts. Sunlight delivers about 1,361 W/m² at 1 AU, and a silicon panel at roughly 20 % efficiency turns about 270 W/m² of that into current, less at night and in storms. Charge is stored in capacitors and cells.',
    specs: [['Solar constant', '1,361 W/m² at 1 AU'], ['Silicon PV efficiency', '≈ 20 %'], ['Coal energy content', '≈ 24 MJ/kg'], ['Unit', '1 W = 1 J per second']],
    game: 'Shown here: the Solar Array (2×2). Every building draws power, even storage silos.',
  },
};
