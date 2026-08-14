import { describe, it, expect } from 'vitest';
import { PRNG, rng } from '@/utils/PRNG';
import { Dice } from '@/game/Dice';

describe('PRNG — determinism', () => {
  it('replays an identical sequence from the same seed', () => {
    const a = new PRNG(12345);
    const b = new PRNG(12345);
    const seqA = Array.from({ length: 200 }, () => a.next());
    const seqB = Array.from({ length: 200 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences from different seeds', () => {
    const a = Array.from({ length: 50 }, ((p) => () => p.next())(new PRNG(1)));
    const b = Array.from({ length: 50 }, ((p) => () => p.next())(new PRNG(2)));
    expect(a).not.toEqual(b);
  });

  it('re-seeds in place via seed()', () => {
    const p = new PRNG(7);
    const first = Array.from({ length: 20 }, () => p.next());
    p.seed(7);
    expect(Array.from({ length: 20 }, () => p.next())).toEqual(first);
  });

  it('stays within [0, 1)', () => {
    const p = new PRNG(999);
    for (let i = 0; i < 20_000; i++) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('PRNG.int', () => {
  it('stays inside the inclusive bounds', () => {
    const p = new PRNG(2024);
    for (let i = 0; i < 20_000; i++) {
      const v = p.int(1, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('reaches both endpoints', () => {
    const p = new PRNG(5);
    const seen = new Set(Array.from({ length: 5_000 }, () => p.int(1, 6)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('PRNG.shuffle', () => {
  it('is a permutation — no elements lost or duplicated', () => {
    const p = new PRNG(31);
    const source = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = p.shuffle([...source]);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(source);
  });

  it('is deterministic for a given seed', () => {
    const source = Array.from({ length: 30 }, (_, i) => i);
    const a = new PRNG(77).shuffle([...source]);
    const b = new PRNG(77).shuffle([...source]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(source); // vanishingly unlikely to be identity
  });
});

// Regression for the "fix roll neg-number" commit: a die must never fall
// outside 1–6, because an out-of-range total corrupts player.position and
// every later roll cascades the bad value.
describe('Dice', () => {
  // One assertion, not 140,000: this used to call `expect` seven times per roll
  // over 20,000 rolls, which was slow enough to time out once the simulator's
  // tests started competing for the same core. Collecting the bad rolls and
  // asserting once is both quicker and a better failure message — it says which
  // roll was wrong rather than stopping at the first.
  it('only ever yields faces 1–6 and totals 2–12', () => {
    rng.seed(4242);
    const dice = new Dice();
    const bad: string[] = [];

    for (let i = 0; i < 20_000; i++) {
      const r = dice.roll();
      const ok = r.die1 >= 1 && r.die1 <= 6
              && r.die2 >= 1 && r.die2 <= 6
              && r.total === r.die1 + r.die2;
      if (!ok) bad.push(`roll ${i}: ${r.die1}+${r.die2}=${r.total}`);
    }
    expect(bad).toEqual([]);
  });

  it('flags doubles exactly when the faces match', () => {
    rng.seed(1);
    const dice = new Dice();
    for (let i = 0; i < 2_000; i++) {
      const r = dice.roll();
      expect(r.isDoubles).toBe(r.die1 === r.die2);
    }
  });

  it('replays the same rolls after re-seeding the shared generator', () => {
    rng.seed(8080);
    const first = Array.from({ length: 40 }, ((d) => () => d.roll().total)(new Dice()));
    rng.seed(8080);
    const again = Array.from({ length: 40 }, ((d) => () => d.roll().total)(new Dice()));
    expect(again).toEqual(first);
  });

  it('rolls doubles at roughly the expected 1-in-6 rate', () => {
    rng.seed(31337);
    const dice = new Dice();
    let doubles = 0;
    const n = 60_000;
    for (let i = 0; i < n; i++) if (dice.roll().isDoubles) doubles++;
    expect(doubles / n).toBeGreaterThan(0.15);
    expect(doubles / n).toBeLessThan(0.18);
  });
});
