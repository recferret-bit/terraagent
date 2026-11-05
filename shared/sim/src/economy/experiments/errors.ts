/** Invalid experiment input (unknown scenario, behaviour, mismatched pin): the CLI maps it to exit code 2. */
export class ExperimentInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ExperimentInputError';
  }
}
