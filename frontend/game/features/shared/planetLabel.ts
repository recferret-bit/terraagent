const BIOME_LABELS: Readonly<Record<string, string>> = {
  dune: 'Dune',
  desert: 'Desert',
  arid: 'Arid',
  temperate: 'Temperate',
  oceanforest: 'Ocean Forest',
  forestrock: 'Forest Rock',
  ice: 'Ice',
  arctic: 'Arctic',
};

function formatTokenWords(raw: string): string {
  const spaced = raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  if (!spaced) return '';
  return spaced
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Formats internal planet IDs (`pl_w18`, `planet_w20`, `pl_dev`) and biome types into clean player-facing labels
 * while preserving named planets (`Dune Prime`, `Helios`).
 */
export function formatPlanetDisplayLabel(planetId?: string | null, planetType?: string | null): string {
  const rawId = (planetId ?? '').trim();
  const rawType = (planetType ?? '').trim();
  const biomeLabel = rawType ? (BIOME_LABELS[rawType.toLowerCase()] ?? formatTokenWords(rawType)) : '';

  if (!rawId) return biomeLabel || '—';

  const sectorMatch = /^(?:pl|planet)[_-]+([a-z0-9]+)$/i.exec(rawId);
  if (sectorMatch) {
    const rawCode = sectorMatch[1]!.toUpperCase();
    const code = rawCode.length > 6 ? `#${rawCode.slice(-4)}` : rawCode;
    return biomeLabel ? `Sector ${code} · ${biomeLabel}` : `Sector ${code}`;
  }

  const directBiome = BIOME_LABELS[rawId.toLowerCase()];
  if (directBiome) return directBiome;

  const cleanName = rawId.includes(' ') ? rawId : formatTokenWords(rawId);
  if (biomeLabel && !cleanName.toLowerCase().includes(biomeLabel.toLowerCase())) {
    return `${cleanName} · ${biomeLabel}`;
  }
  return cleanName;
}
