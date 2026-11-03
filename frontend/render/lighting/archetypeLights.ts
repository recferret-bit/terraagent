export interface ArchetypeLightSource {
  id: string;
  /** Local position [x, y, z] relative to the archetype root (in model space, where y = 0 is ground). */
  pos: [number, number, number];
  /** Local target point [tx, ty, tz] on the ground/plane that the light beam aims at and illuminates. */
  target: [number, number, number];
  /** Hex color (e.g. 0x9ee6ff or 0xffe4b5). */
  color: number;
  /** Projector intensity (default ~1.35 for robots, ~1.15 for building corners). */
  intensity: number;
  /** Ground projector range in metres (default ~11 for robots, ~9.5 for buildings). */
  range: number;
  /** Volumetric cone top radius (lamp aperture, e.g. 0.14) and bottom radius (beam spread, e.g. 1.75). */
  coneTopRadius: number;
  coneBottomRadius: number;
  /** Ground pool disc radius (e.g. 2.4). */
  poolRadius: number;
}

function makeCornerLights(opts: {
  rx: number;
  ry: number;
  rz: number;
  tx: number;
  ty?: number;
  tz: number;
  color: number;
  intensity: number;
  range: number;
  coneTopRadius: number;
  coneBottomRadius: number;
  poolRadius: number;
}): ArchetypeLightSource[] {
  const ty = opts.ty ?? 0.02;
  const corners: ReadonlyArray<{ id: string; sx: number; sz: number }> = [
    { id: 'ne', sx: 1, sz: 1 },
    { id: 'nw', sx: -1, sz: 1 },
    { id: 'se', sx: 1, sz: -1 },
    { id: 'sw', sx: -1, sz: -1 },
  ];
  return corners.map(({ id, sx, sz }) => ({
    id,
    pos: [sx * opts.rx, opts.ry, sz * opts.rz],
    target: [sx * opts.tx, ty, sz * opts.tz],
    color: opts.color,
    intensity: opts.intensity,
    range: opts.range,
    coneTopRadius: opts.coneTopRadius,
    coneBottomRadius: opts.coneBottomRadius,
    poolRadius: opts.poolRadius,
  }));
}

function makeStandardRobotHeadlamp(): ArchetypeLightSource[] {
  return [
    {
      id: 'headlamp',
      pos: [0, 1.55, 0.35],
      target: [0, 0.02, 4.0],
      color: 0x9ee6ff,
      intensity: 1.3,
      range: 10.5,
      coneTopRadius: 0.13,
      coneBottomRadius: 1.65,
      poolRadius: 2.5,
    },
  ];
}

export const DEFAULT_ARCHETYPE_LIGHTS: Readonly<Record<string, ReadonlyArray<ArchetypeLightSource>>> = {
  'robot.hero': [
    {
      id: 'headlamp',
      pos: [0, 1.88, 0.36],
      target: [0, 0.02, 4.4],
      color: 0x9ee6ff,
      intensity: 1.45,
      range: 11.5,
      coneTopRadius: 0.14,
      coneBottomRadius: 1.85,
      poolRadius: 2.8,
    },
  ],
  'robot.miner': makeStandardRobotHeadlamp(),
  'robot.builder': makeStandardRobotHeadlamp(),
  'robot.scout': makeStandardRobotHeadlamp(),
  'robot.hauler': makeStandardRobotHeadlamp(),
  'robot.combat': makeStandardRobotHeadlamp(),
  'robot.tleilaxu': makeStandardRobotHeadlamp(),
  'robot.raid': makeStandardRobotHeadlamp(),
  'building.commandHub': makeCornerLights({
    rx: 1.55,
    ry: 2.25,
    rz: 1.55,
    tx: 4.2,
    tz: 4.2,
    color: 0xffe4b5,
    intensity: 1.25,
    range: 10.5,
    coneTopRadius: 0.14,
    coneBottomRadius: 1.75,
    poolRadius: 2.5,
  }),
  'building.mine': makeCornerLights({
    rx: 1.18,
    ry: 1.85,
    rz: 1.18,
    tx: 3.4,
    tz: 3.4,
    color: 0xffe4b5,
    intensity: 1.2,
    range: 9.0,
    coneTopRadius: 0.12,
    coneBottomRadius: 1.45,
    poolRadius: 2.1,
  }),
  'building.solar': makeCornerLights({
    rx: 1.15,
    ry: 1.35,
    rz: 1.15,
    tx: 3.0,
    tz: 3.0,
    color: 0x9ee6ff,
    intensity: 1.05,
    range: 7.5,
    coneTopRadius: 0.1,
    coneBottomRadius: 1.25,
    poolRadius: 1.8,
  }),
  // The drop pod carries no projector lights (owner decision): no cones/pools in the orbit bay, freefall or on the
  // landed pod, and no GPU colony projectors from `entityVisionSync`. Kept as an explicit empty entry so the
  // playground LIGHTS editor still lists it and can author lights live.
  'ship.dropPod': [],
};

function cloneLight(s: ArchetypeLightSource): ArchetypeLightSource {
  return {
    id: s.id,
    pos: [s.pos[0], s.pos[1], s.pos[2]],
    target: [s.target[0], s.target[1], s.target[2]],
    color: s.color,
    intensity: s.intensity,
    range: s.range,
    coneTopRadius: s.coneTopRadius,
    coneBottomRadius: s.coneBottomRadius,
    poolRadius: s.poolRadius,
  };
}

function resolveDefaultLights(archetypeId: string): ArchetypeLightSource[] {
  const explicit = DEFAULT_ARCHETYPE_LIGHTS[archetypeId];
  if (explicit) return explicit.map(cloneLight);
  if (archetypeId.startsWith('robot.')) return makeStandardRobotHeadlamp();
  if (archetypeId === 'building.rocket' || archetypeId === 'building.roboticsFactory') {
    return DEFAULT_ARCHETYPE_LIGHTS['building.commandHub']!.map(cloneLight);
  }
  if (archetypeId.startsWith('building.')) {
    return DEFAULT_ARCHETYPE_LIGHTS['building.mine']!.map(cloneLight);
  }
  return [];
}

const liveRegistry = new Map<string, ArchetypeLightSource[]>();
const versionMap = new Map<string, number>();
const changeListeners = new Set<(archetypeId: string) => void>();

function ensureLiveEntry(archetypeId: string): ArchetypeLightSource[] {
  let list = liveRegistry.get(archetypeId);
  if (!list) {
    list = resolveDefaultLights(archetypeId);
    liveRegistry.set(archetypeId, list);
  }
  return list;
}

function notifyLightChange(archetypeId: string): void {
  versionMap.set(archetypeId, (versionMap.get(archetypeId) ?? 0) + 1);
  for (const listener of changeListeners) {
    listener(archetypeId);
  }
}

/** Monotonic revision number for `archetypeId`'s light configuration (used for zero-overhead live rebuilds). */
export function getArchetypeLightsVersion(archetypeId: string): number {
  return versionMap.get(archetypeId) ?? 0;
}

/** Returns the active light source configurations for `archetypeId`. */
export function getArchetypeLights(archetypeId: string): ArchetypeLightSource[] {
  return ensureLiveEntry(archetypeId).map(cloneLight);
}

/**
 * The live light list for `archetypeId`, not copied: for per-frame readers (projector upload, playground sync) that
 * must not allocate. Never mutate it; edits go through `setArchetypeLights` / `updateArchetypeLight` (version bump).
 */
export function peekArchetypeLights(archetypeId: string): ReadonlyArray<Readonly<ArchetypeLightSource>> {
  return ensureLiveEntry(archetypeId);
}

/** Replaces the light source list for `archetypeId` and notifies listeners. */
export function setArchetypeLights(archetypeId: string, lights: ArchetypeLightSource[]): void {
  liveRegistry.set(archetypeId, lights.map(cloneLight));
  notifyLightChange(archetypeId);
}

/** Appends a new light source to `archetypeId` and returns the created source. */
export function addArchetypeLight(archetypeId: string, light?: Partial<ArchetypeLightSource>): ArchetypeLightSource {
  const list = ensureLiveEntry(archetypeId);
  const isRobot = archetypeId.startsWith('robot.');
  const idx = list.length + 1;
  const created: ArchetypeLightSource = {
    id: light?.id ?? (isRobot ? `headlamp-${idx}` : `light-${idx}`),
    pos: light?.pos ? [...light.pos] : isRobot ? [0, 1.55, 0.35] : [1.2, 1.8, 1.2],
    target: light?.target ? [...light.target] : isRobot ? [0, 0.02, 4.0] : [3.2, 0.02, 3.2],
    color: light?.color ?? (isRobot ? 0x9ee6ff : 0xffe4b5),
    intensity: light?.intensity ?? (isRobot ? 1.3 : 1.2),
    range: light?.range ?? (isRobot ? 10.5 : 9.0),
    coneTopRadius: light?.coneTopRadius ?? 0.12,
    coneBottomRadius: light?.coneBottomRadius ?? 1.5,
    poolRadius: light?.poolRadius ?? 2.2,
  };
  list.push(created);
  notifyLightChange(archetypeId);
  return cloneLight(created);
}

/** Removes a light source from `archetypeId` by array index or `id`. */
export function removeArchetypeLight(archetypeId: string, indexOrId: number | string): void {
  const list = ensureLiveEntry(archetypeId);
  const idx = typeof indexOrId === 'number' ? indexOrId : list.findIndex((s) => s.id === indexOrId);
  if (idx >= 0 && idx < list.length) {
    list.splice(idx, 1);
    notifyLightChange(archetypeId);
  }
}

/** Updates a single light source at `index` on `archetypeId` with `patch`. */
export function updateArchetypeLight(archetypeId: string, index: number, patch: Partial<ArchetypeLightSource>): void {
  const list = ensureLiveEntry(archetypeId);
  const cur = list[index];
  if (!cur) return;
  list[index] = {
    id: patch.id ?? cur.id,
    pos: patch.pos ? [patch.pos[0], patch.pos[1], patch.pos[2]] : cur.pos,
    target: patch.target ? [patch.target[0], patch.target[1], patch.target[2]] : cur.target,
    color: patch.color ?? cur.color,
    intensity: patch.intensity ?? cur.intensity,
    range: patch.range ?? cur.range,
    coneTopRadius: patch.coneTopRadius ?? cur.coneTopRadius,
    coneBottomRadius: patch.coneBottomRadius ?? cur.coneBottomRadius,
    poolRadius: patch.poolRadius ?? cur.poolRadius,
  };
  notifyLightChange(archetypeId);
}

/** Resets `archetypeId` (or all archetypes when omitted) back to `DEFAULT_ARCHETYPE_LIGHTS`. */
export function resetArchetypeLights(archetypeId?: string): void {
  if (archetypeId !== undefined) {
    liveRegistry.set(archetypeId, resolveDefaultLights(archetypeId));
    notifyLightChange(archetypeId);
    return;
  }
  const keys = new Set<string>([...Object.keys(DEFAULT_ARCHETYPE_LIGHTS), ...liveRegistry.keys()]);
  liveRegistry.clear();
  for (const key of keys) {
    notifyLightChange(key);
  }
}

function roundNum(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function formatLightSourceCode(s: ArchetypeLightSource): string {
  const hex = `0x${Math.max(0, Math.min(0xffffff, Math.round(s.color))).toString(16).padStart(6, '0')}`;
  const pos = `[${roundNum(s.pos[0])}, ${roundNum(s.pos[1])}, ${roundNum(s.pos[2])}]`;
  const target = `[${roundNum(s.target[0])}, ${roundNum(s.target[1])}, ${roundNum(s.target[2])}]`;
  return [
    '    {',
    `      id: ${JSON.stringify(s.id)},`,
    `      pos: ${pos},`,
    `      target: ${target},`,
    `      color: ${hex},`,
    `      intensity: ${roundNum(s.intensity)},`,
    `      range: ${roundNum(s.range)},`,
    `      coneTopRadius: ${roundNum(s.coneTopRadius)},`,
    `      coneBottomRadius: ${roundNum(s.coneBottomRadius)},`,
    `      poolRadius: ${roundNum(s.poolRadius)},`,
    '    },',
  ].join('\n');
}

/** Formats TypeScript configuration code for `archetypeId` (or all configured archetypes) for copy-pasting into `archetypeLights.ts`. */
export function exportArchetypeLightsCode(archetypeId?: string): string {
  if (archetypeId !== undefined) {
    const lights = getArchetypeLights(archetypeId);
    return `  '${archetypeId}': [\n${lights.map(formatLightSourceCode).join('\n')}\n  ],`;
  }
  const keys = [...new Set([...Object.keys(DEFAULT_ARCHETYPE_LIGHTS), ...liveRegistry.keys()])];
  const entries = keys.map((k) => {
    const lights = getArchetypeLights(k);
    return `  '${k}': [\n${lights.map(formatLightSourceCode).join('\n')}\n  ],`;
  });
  return `export const DEFAULT_ARCHETYPE_LIGHTS: Record<string, ArchetypeLightSource[]> = {\n${entries.join('\n')}\n};`;
}

/** Subscribes to live archetype light edits; returns an unsubscribe callback. */
export function onArchetypeLightsChange(listener: (archetypeId: string) => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
