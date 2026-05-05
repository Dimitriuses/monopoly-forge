// ─── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────
// Deterministic random number generation — pass a seed for reproducible games.

export class PRNG {
  private state: number;

  constructor(seed?: number) {
    this.state = seed ?? Math.floor(Math.random() * 0xffffffff);
  }

  /** Returns a float in [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let z = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    z = (z ^ (z + Math.imul(z ^ (z >>> 7), 61 | z))) >>> 0;
    return (z ^ (z >>> 14)) / 0x100000000;
  }

  /** Returns an integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Shuffles array in-place using Fisher-Yates */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Returns a copy of the current seed (for save/load) */
  getSeed(): number {
    return this.state;
  }
}

// Default global PRNG instance (re-seed on game start)
export const rng = new PRNG();
