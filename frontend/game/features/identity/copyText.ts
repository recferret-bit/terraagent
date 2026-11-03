/** A writer the chip can call. Specs pass a fake; the page uses `navigator.clipboard`. */
export interface TextClipboard {
  writeText(text: string): Promise<void>;
}

/** Copies `text`. Returns `ok` or `fail` and never throws. */
export async function copyText(text: string, clipboard?: TextClipboard): Promise<'ok' | 'fail'> {
  try {
    const writer = clipboard ?? navigatorClipboard();
    if (!writer) return 'fail';
    await writer.writeText(text);
    return 'ok';
  } catch {
    return 'fail';
  }
}

function navigatorClipboard(): TextClipboard | null {
  try {
    const writer = navigator.clipboard;
    if (!writer || typeof writer.writeText !== 'function') return null;
    return writer;
  } catch {
    return null;
  }
}
