// ─── Download ─────────────────────────────────────────────────────────────────
// Getting text out of a canvas game.
//
// The turn log has kept the whole game since M8c and there has never been a way
// to read one afterwards: no copy, no file, and nothing surviving the tab being
// closed. Two routes, because neither works everywhere:
//
//   * the clipboard, which is what somebody wants nine times in ten, and which
//     browsers refuse outside a user gesture and outside a secure context;
//   * a file, which always works but is a heavier thing to have happened.
//
// In `ui/` rather than `utils/` for the usual reason: both touch `window`, and
// everything under `utils/` has to keep running in plain Node.

/** Copy text, reporting whether it actually went. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  try {
    // `navigator.clipboard` is undefined on http:// and inside some embeds, so
    // its absence is a normal outcome rather than an error.
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Save text as a file. Returns false if the browser would not have it. */
export function downloadText(filename: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next frame: revoking synchronously can beat the click in
    // some browsers and save an empty file.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

/** `monopoly-forge-classic-2026-08-14.txt` — sortable, and says which game. */
export function transcriptFilename(gameId: string): string {
  const when = new Date().toISOString().slice(0, 10);
  return `monopoly-forge-${gameId || 'game'}-${when}.txt`;
}
