import {
  advancePose,
  getMotion,
  getPathStats,
  hexDistance,
  hexRound,
  rowOf,
  type PlanetState,
  type SimHost,
} from '../../src';

export interface Pose {
  x: number;
  y: number;
  q: number;
  r: number;
}

interface SavedRoute {
  key: string;
  x: number;
  y: number;
  next: number;
  path: number[];
}

/** Steps a host and checks every future pose against `advancePose` on the stored route. */
export class MarchOracle {
  private readonly prev = new Map<number, Pose>();
  private readonly route = new Map<number, SavedRoute>();
  readonly samples: Array<Map<number, Pose>> = [];
  readonly expansions: number[] = [];
  loose = new Set<number>();

  constructor(
    private readonly host: SimHost,
    private readonly ids: readonly number[],
    private readonly speedOf: (id: number) => number,
  ) {
    for (const id of ids) this.prev.set(id, poseOf(host.state, id));
  }

  step(): void {
    const before = new Map(this.prev);
    this.host.step(1);
    this.expansions.push(getPathStats(this.host.state).lastStepExpansions);
    for (const id of this.ids) this.check(id, before.get(id)!);
    this.samples.push(new Map(this.prev));
  }

  steps(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  private check(id: number, before: Pose): void {
    const now = poseOf(this.host.state, id);
    const speed = this.speedOf(id);
    const disp = hexDistance(before.x, before.y, now.x, now.y);
    expectWithin(disp, speed);
    const [q, r] = hexRound(now.x, now.y);
    if (now.q !== q || now.r !== r) throw new Error(`unit ${id} tile ${now.q},${now.r} is not hexRound(${now.x},${now.y})`);
    const motion = getMotion(this.host.state, id);
    const saved = this.route.get(id);
    const path = motion && motion.path.length > 0 ? motion.path : null;
    const key = path ? path.join(',') : '';
    if (path && (!saved || saved.key !== key)) this.adopt(id, before, now, path, key, speed);
    else if (saved && (path || now.x !== before.x || now.y !== before.y)) this.follow(id, saved, before, now, speed);
    else if (now.x !== before.x || now.y !== before.y) throw new Error(`unit ${id} moved without a route`);
    else this.route.delete(id);
    this.prev.set(id, now);
  }

  private adopt(id: number, before: Pose, now: Pose, path: number[], key: string, speed: number): void {
    const stepped = advancePose(before.x, before.y, path, 0, speed);
    if (stepped.x === now.x && stepped.y === now.y) {
      this.route.set(id, { key, x: now.x, y: now.y, next: stepped.next, path: path.slice() });
      return;
    }
    if (!this.loose.has(id)) throw new Error(`unit ${id} left its new route: ${now.x},${now.y} vs ${stepped.x},${stepped.y}`);
    this.route.delete(id);
  }

  private follow(id: number, saved: SavedRoute, before: Pose, now: Pose, speed: number): void {
    const stepped = advancePose(saved.x, saved.y, saved.path, saved.next, speed);
    if (stepped.x === now.x && stepped.y === now.y) {
      saved.x = now.x;
      saved.y = now.y;
      saved.next = stepped.next;
      if (stepped.arrived) this.route.delete(id);
      return;
    }
    if (!this.loose.has(id)) throw new Error(`unit ${id} left its route at ${now.x},${now.y}, expected ${stepped.x},${stepped.y}`);
    this.route.delete(id);
    if (now.x !== before.x || now.y !== before.y) this.adopt(id, before, now, saved.path, saved.key, speed);
  }
}

function poseOf(state: PlanetState, id: number): Pose {
  const row = rowOf(state.entities, id);
  const cols = state.entities.cols;
  return { x: cols.x[row], y: cols.y[row], q: cols.q[row], r: cols.r[row] };
}

function expectWithin(disp: number, speed: number): void {
  if (disp > speed + 1e-4) throw new Error(`step ${disp} exceeds speed ${speed}`);
}

export function pose(host: SimHost, id: number): Pose {
  return poseOf(host.state, id);
}
