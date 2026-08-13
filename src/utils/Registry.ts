// ─── Registry ─────────────────────────────────────────────────────────────────
// A named set of things a game can add to: tile types, card effects, turn
// orders, win conditions, variants. M8 grew five of these, each a module-level
// `Map` with its own `registerX` / `knownX` / `xNamed` trio, and each with the
// same bug waiting in it — one process, one namespace.
//
// That cost nothing while a browser tab played one game. It stops being free the
// moment two games are loaded into one process, which is the whole premise of
// the simulator: two games that each register a `tollBooth`, or each replace
// `collectFromBank`, would quietly get each other's, and the result would be a
// *wrong* answer rather than a crash.
//
// So the five became one class with `capture` and `restore`. What that buys is
// **serial isolation**: loading a game resets every registry to the built-ins
// and applies that game's own. Two games cannot leak into each other because
// only one is ever in force. It is not concurrent isolation — nothing here lets
// two games be live at the same instant — and that is the honest limit, written
// down rather than implied. A batch runs one game at a time, which is what a
// batch is.

export class Registry<T> {
  /** What this registry holds, for the message an unknown name gets. */
  readonly what: string;
  private entries = new Map<string, T>();

  constructor(what: string) {
    this.what = what;
  }

  /** Teach the engine one. Registering over a name replaces it. */
  set(name: string, value: T): void {
    this.entries.set(name, value);
  }

  get(name: string): T | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  delete(name: string): boolean {
    return this.entries.delete(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  values(): T[] {
    return [...this.entries.values()];
  }

  /**
   * Look one up, or refuse by name. For the registries where an unknown entry
   * means a game nobody can play — a tile type, a turn order — rather than the
   * ones where it means one odd card.
   */
  require(name: string): T {
    const value = this.entries.get(name);
    if (value === undefined) {
      throw new Error(
        `[${this.what}] nothing called "${name}" — known: ${this.names().join(', ') || 'none'}`,
      );
    }
    return value;
  }

  // ── Scoping ─────────────────────────────────────────────────────────────────

  /** Everything registered right now, to be handed back to `restore` later. */
  capture(): Map<string, T> {
    return new Map(this.entries);
  }

  /** Put it back exactly as it was, dropping anything registered since. */
  restore(snapshot: Map<string, T>): void {
    this.entries = new Map(snapshot);
  }
}
