/** One in-process turn per NPC. A later fill waits until the earlier fill has written inventory. */
export class NpcTurnQueue {
  private readonly tail = new Map<string, Promise<void>>();

  run<T>(npcId: string, job: () => Promise<T>): Promise<T> {
    const prev = this.tail.get(npcId) ?? Promise.resolve();
    const run = prev.then(job, job);
    this.tail.set(npcId, run.then(() => undefined, () => undefined));
    return run;
  }
}
