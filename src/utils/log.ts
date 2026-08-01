// ─── Debug logging ────────────────────────────────────────────────────────────
// The turn/card/jail tracing that found most of the bugs in DEVLOG.md is still
// in the code, but it is noisy enough to bury a real problem when left on. It is
// therefore off by default and switched on explicitly:
//
//   • dev server            — on (main.ts, via import.meta.env.DEV)
//   • ?debug=1 in the URL   — on, including on the deployed build
//   • unit tests            — off, so the suite stays quiet and fast
//
// This module deliberately reads no `import.meta` and touches no DOM, so the
// model layer can import it and still run under plain Node. main.ts owns the
// decision and calls setDebugLogging().
//
// console.error is intentionally NOT routed through here — a genuine fault
// should always reach the console, however logging is configured.

let enabled = false;

export function setDebugLogging(on: boolean): void {
  enabled = on;
}

export function isDebugLogging(): boolean {
  return enabled;
}

export function dlog(...args: unknown[]): void {
  if (enabled) console.log(...args);
}

export function dwarn(...args: unknown[]): void {
  if (enabled) console.warn(...args);
}
