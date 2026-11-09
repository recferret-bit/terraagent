import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ArtifactRef { readonly name: string; readonly bytes: number; readonly sha256: string }

export const ARTIFACT_NAME = /^[\w.-]{1,120}$/;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Checksummed files of one experiment under `<dir>/<experimentId>/` (JSON, JSONL, CSV; flat names). */
export class ArtifactStore {
  constructor(private readonly dir: string) {}

  private path(experimentId: string, name: string): string {
    return join(resolve(this.dir), experimentId, name);
  }

  async write(experimentId: string, name: string, text: string): Promise<ArtifactRef> {
    if (!ARTIFACT_NAME.test(name)) throw new Error(`bad artifact name ${name}`);
    await mkdir(join(resolve(this.dir), experimentId), { recursive: true });
    await writeFile(this.path(experimentId, name), text);
    return { name, bytes: Buffer.byteLength(text), sha256: sha(text) };
  }

  /** Reads a file and verifies it against its stored checksum (a changed file is an error, never served). */
  async read(experimentId: string, ref: ArtifactRef): Promise<string> {
    const text = await readFile(this.path(experimentId, ref.name), 'utf8');
    if (sha(text) !== ref.sha256) throw new Error(`artifact ${ref.name} does not match its checksum`);
    return text;
  }
}
