import { directorBoot } from './main.js';

/** One line a supervisor can check. `--check` prints it and returns. */
export function directorLine(argv: readonly string[] = process.argv): string {
  const boot = directorBoot();
  const line = `director ${boot.role} up db=${boot.gameDb}`;
  if (argv.includes('--check')) return line;
  return line;
}

const isMain = process.argv[1]?.includes('cli');
if (isMain) {
  process.stdout.write(`${directorLine()}\n`);
}
