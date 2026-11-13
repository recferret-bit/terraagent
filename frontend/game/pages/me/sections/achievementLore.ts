import type { AchievementFamilyId, AchievementTier, PlayerAchievementEntry } from '@terra/contracts';

export const ROMAN_TIER: Readonly<Record<AchievementTier, string>> = {
  1: 'I',
  2: 'II',
  3: 'III',
};

/**
 * Souls-style relic lore & riddles for all 20 achievement families × 3 tiers (60 inscriptions).
 */
export const ACHIEVEMENT_LORE_BY_FAMILY: Readonly<
  Record<AchievementFamilyId, readonly [string, string, string]>
> = {
  'first-landfall': [
    'Brass seal of the first descent. An iron seed falls through screaming fire to bite the silent dust. Tell me, pioneer: what has no roots, yet claims a world the moment it touches stone?',
    'Silvered emblem of the three beacons. Where one fire burned alone in the dark, two sisters now answer across the void. Three cradles kindled under foreign stars—yet which of them still remembers Earth?',
    'Golden crest of the Tenfold Drop. Ten worlds bear the scar of your retro-thrusters upon their virgin crust. Do you sow empires across the abyss, or merely scatter your graves among the stars?',
  ],
  groundbreaker: [
    'Worn tooth of a frontier grading blade. The wild ridge knows neither plumb nor level until the iron descends. What devours the hill and fills the hollow, yet leaves only stillness behind?',
    'Tempered surveyor plumb from the thousandth hex. Ancient contours shaped by eons of wind are planed to mirror-flatness in a single afternoon. The earth yields, though it does not forgive.',
    'Gilded level of the Great Grading. Ten thousand scars made flat beneath an indifferent sky. When every mountain is brought low and every valley erased, where shall the shadow hide at noon?',
  ],
  'stone-mason': [
    'Chipped chisel of the perimeter crews. Before the first plinth may rise, the old monoliths must fall. Strike the silent crag and answer: what sleeps for a million years, only to wake as dust?',
    'Silver-inlaid cutter core, warm to the touch. Five hundred boulders shattered to gravel and ash; the plasma beam sings a hollow hymn, chewing through ages of patient stone.',
    'Sovereign mason seal, heavy as core-iron. Five thousand obstacles erased from the ledger of the land. Nothing stands where you decree a road—save the ghost of the mountain you unmade.',
  ],
  'hydro-engineer': [
    'Salt-crusted valve from a reclamation dike. The dark brine yields grudgingly to the pump. What has no hands, yet drowns the careless, and retreats only when caged in steel?',
    'Silver impeller of the deep-basin drains. A hundred shallows drunk dry by the intake manifolds; where leviathans once drifted in the mire, iron boots now march upon bleached clay.',
    'Golden tide-seal of the Hydro Lords. A thousand waters bound in conduits and reservoirs. You have bridled the weeping of the world—yet water, blind and patient, never forgets its bed.',
  ],
  'green-thumb': [
    'Pressed spore-capsule sealed in amber glass. In regolith that knew only rust and ash, a solitary blade uncurls. What drinks the dead dust and breathes out a living sky?',
    'Silver grafting-knife of the biodome tenders. Five hundred hexes clothed in emerald breath; blind roots split the silent stone, feasting on a world that never asked to bloom.',
    'Golden wreath of the Living Lattice. A verdant sea where once the barren wasteland held court. Beware the garden grown too lush—for where life feasts, hunger is never far behind.',
  ],
  architect: [
    'Riveted gusset plate from the first compound. Plinth and girder bolted fast against the gale. What has ribs of gunmetal and lungs of wire, yet dies the instant the current stops?',
    'Silver draft-compass of the master builders. Two hundred and fifty spires of alloy and glass rise from the basin, humming with a tireless pulse that is not their own.',
    'Golden keystone of the Endless Foundry. Two thousand five hundred monuments to industry crown the plain. When the horizon itself is teeth of steel, who shall remember the shape of the hills?',
  ],
  'power-broker': [
    'Scorched copper bus-bar from an early reactor. A hundred currents bound in braided veins. What runs without legs, bites without teeth, and starves the colony the moment it rests?',
    'Silvered insulator coil humming with residual charge. Five hundred surges course through the spine of the grid. The air tastes of ozone and ambition; the machines no longer sleep.',
    'Golden arc-crown of the High Grid. Two thousand bolts of bottled daylight bend to your switches. You hold a captive star within your conduits—pray the cage outlasts the prisoner.',
  ],
  'night-shift': [
    'Dim lantern-core that burned till dawn. The sun sinks beneath the planetary rim, and the long cold presses against the hull. What weighs nothing at noon, yet crushes the unprepared at midnight?',
    'Silvered capacitor plate of the tenth vigil. While the surface freezes in the shadow of orbit, the accumulators remember the vanished sun and keep the dark outside the wire.',
    'Golden sundial of the Unblinking Watch. Fifty midnights conquered without a single faltering lamp. You have banished twilight from your walls—yet the darkness beyond only grows denser.',
  ],
  stockpile: [
    'Stamped tally-token from the first depot. Ten thousand measures of ore and crude stacked in silent vaults. What is dug from the dark only to be locked in the dark again?',
    'Silver assay weight of the central logistics hub. A hundred thousand ingots, cold and numbered; the foundations groan beneath the tithe torn from the planet ribs.',
    'Golden ledger-seal of the Millionth Measure. A million fragments of the world, refined and catalogued. Tell me, Steward of the Vault: when the planet is hollowed out, what will your ledgers weigh?',
  ],
  'tech-ascendant': [
    'Bronze chevron of the Fifth Charter Seal. The research uplink pierces the ionosphere, and the crude tools of survival give way to the cold instruments of dominion.',
    'Silver spire-crest of the Eighth Stage. The orbital beacons align in silent geometry; the planet below is no longer a shelter, but an engine.',
    'Radiant sigil of the Tenth Stage—the apex of the Charter. Those who climb every rung of the ancients cease to look upon the dirt; their eyes are fixed upon the next star.',
  ],
  exterminator: [
    'Serrated mandible trophy, dark with dried ichor. Fifty carapaces cracked upon the perimeter. They were here before the drop-pods fell; tell me, who is the pest and who is the host?',
    'Silver-mounted chitin shard from the five-hundredth kill. Husks bleach along the graded stone, yet the frantic chittering beneath the crust does not cease.',
    'Golden hunting-crest of the Red Perimeter. Five thousand swarms ground to chitin and ash. You call them pestilence; the planet calls them antibodies. Which of you is the fever?',
  ],
  'nest-breaker': [
    'Charred resin fragment from a collapsed mound. Smoke curls from the vent where the brood-pulse once echoed through the dirt. Cut the branch and the swarm scatters; burn the root and what remains?',
    'Silver torch-emblem of the tunnel clearers. Ten hives hollowed by fire and iron, striking deep into the warm dark where blind larvae dream of the surface.',
    'Golden seal of the Silent Strata. Fifty cradles of chitin reduced to cinders. The subterranean halls lie empty at last—though in the deepest fault-lines, something older stirs.',
  ],
  'great-wall': [
    'Iron surveyor stake from the first rampart. Twenty ridges heaped from the living earth, drawing a line in stone and trench: this side is order, that side is the wild.',
    'Silvered bastion-clasp of the ringed basin. Two hundred earthworks stand watch where turrets cannot reach, drafting the very soil into the colony guard.',
    'Golden keystone of the Planetary Bulwark. Two thousand leagues of ridge and moat, a fortress-scar visible from low orbit. Tell me: does the wall keep the terrors out, or lock the builders in?',
  ],
  unbreached: [
    'Unscarred shield-plate from the fifth assault. Five times the tide of claws broke against the perimeter; five times not a single bolt was sheared from its plinth.',
    'Silver aegis of the fiftieth siren. Fifty onslaughts turned to smoke at the wire; the alarms wail and fall silent, and every roof within the compound stands whole.',
    'Golden ward of the Impenetrable Citadel. Two hundred and fifty storms broken upon an anvil of gunmetal. An unbreached fortress is a proud thing—until it forgets how to bleed.',
  ],
  warlord: [
    'Scorched dog-tag of a rival automaton. The beasts of the planet were not enemy enough; now iron turns its teeth upon iron beneath a stranger sky.',
    'Silver targeting-reticle pried from the hundredth wreck. A hundred machines of fellow pilots gutted in the dust; their transponders still whisper their names to an empty frequency.',
    'Blood-gilt Warlord Star. A thousand rival hulls broken under your banner. Among the stars there is no law save wattage and trajectory—and your guns speak both fluently.',
  ],
  merchant: [
    'Stamped copper trade-chit from the first clearing. Where one colony starves for silicon, another drowns in ore; what crosses the void without wings, yet feeds both?',
    'Silver balance-beam of the fiftieth settlement. Fifty cargoes weighed, cleared, and sealed. The orderbook cares nothing for flags or blood—only that the bid meets the ask.',
    'Golden sovereign of the High Exchange. Five hundred settlements etched into the immutable ledger. Empires rise by the drill and fall by the turret, yet both kneel before the price.',
  ],
  'port-authority': [
    'Brass customs-stamp of the outer berth. A hundred tokens skimmed from passing freight. Who harvests every cargo, yet never sows a single tile?',
    'Silver harbor-chain of the thousandth toll. Every caravan that crosses your airlock threshold leaves a splinter of its labor behind in your coffers.',
    'Golden key of the Free Port. Ten thousand tribute-units gathered without firing a shot. The truest conqueror on the frontier is the one whom every rival pays to visit.',
  ],
  'guild-contact': [
    'Cold titanium transponder tuned to high orbit. Five shuttles have answered your beacon from the dark above. The Orbital Guild speaks in numbers, never names.',
    'Silver cargo-seal of the fiftieth tether. Silent barges drink your crude earth and drop cold miracles through the clouds, asking never why.',
    'Golden astrolabe of the Apogee Pact. Two hundred and fifty charters fulfilled with the Lords of Orbit. You are favored in the heavens now—though the Guild never forgets a balance.',
  ],
  diplomat: [
    'Wax-less cipher of a frontier ceasefire. One treaty signed, one silence kept until the clock ran dry. How strange a thing is peace, when the turrets remain loaded.',
    'Silver olive-circuit of the fifth covenant. Five truces honored to their final tick—a rare virtue in the dust: a hand that could strike, yet chooses to stay still.',
    'Golden seal of the Unbroken Word. Twenty-five oaths kept whole amid a sea of treachery. Tell me, Peacemaker: is a truce the absence of war, or merely its intake of breath?',
  ],
  settler: [
    'Ignited nozzle-ring of the first Ark. A pillar of white fire ascends into the dark, leaving a finished world behind. What is built over a lifetime, only to be abandoned in its perfection?',
    'Silver star-chart of the Three Arks. Three worlds brought to the Tenth Stage and released into history; your footsteps echo in cities you will never walk again.',
    'Golden Crown of the Star Settler. Ten planets tamed, ten Arks cast into the deep. You have become a myth told by machines at twilight: the Architect who builds the dawn, and departs.',
  ],
};

export function getAchievementLore(
  entry: Pick<PlayerAchievementEntry, 'familyId' | 'tier'>,
): string {
  const familyLore = ACHIEVEMENT_LORE_BY_FAMILY[entry.familyId];
  if (!familyLore) {
    return 'An unmarked relic from the frontier vaults, its inscription worn away by orbital dust.';
  }
  const idx = Math.max(0, Math.min(2, entry.tier - 1));
  return familyLore[idx] ?? familyLore[0];
}
