// Hero headline variants: set data-hero on .page (or ?hero=) to "robot" | "world" | "director".
const HERO: Record<string, { h1: string; lede: string }> = {
  robot: { h1: 'Drop one robot.\nLeave.\nIt keeps building.', lede: 'An autonomous colony builder. Your robots mine, build, defend and trade on a live planet, around the clock. You set the priorities; the colony does the rest, even while you are away.' },
  world: { h1: 'Colonize a planet\nthat never\nlogs off.', lede: 'Up to five colonies share one live world. Borders freeze where they meet, storms cut your power lines, and the server keeps the clock whether you are watching or not.' },
  director: { h1: 'Set the intent.\nThe colony\nexecutes.', lede: 'Indirect control: a task queue, four priority sliders and an AI Director for emergencies. Every resource and every watt counts, because the economy is the game.' },
};

export function initHeroCopy(page: HTMLElement | null) {
  const variant = new URLSearchParams(location.search).get('hero') || page?.dataset.hero || 'robot';
  const copy = HERO[variant] || HERO.robot;
  const title = document.querySelector('[data-hero-title]'), lede = document.querySelector('[data-hero-lede]');
  if (title) title.textContent = copy.h1;
  if (lede) lede.textContent = copy.lede;
}
