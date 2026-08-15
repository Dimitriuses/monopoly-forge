import { rng } from '@/utils/PRNG';
import { dlog } from '@/utils/log';

export interface DiceResult {
  die1: number;
  die2: number;
  isDoubles: boolean;
  total: number;
}

/** What a roll is for. Everything here is optional; the base dice read none. */
export interface RollContext {
  /** Whose turn it is. */
  player?: { hasLapped: boolean };
}

export class Dice {
  lastResult: DiceResult | null = null;

  /**
   * `ctx` is what the roll is *for*, and the base dice ignore all of it. It
   * exists because a variant's dice may depend on the player — Ultimate
   * Monopoly's speed die is not in play until you have been round the board
   * once — and a variant supplies its own `Dice`, so there is nowhere else for
   * that to live.
   */
  roll(_ctx?: RollContext): DiceResult {
    const die1 = Math.min(6, Math.max(1, Math.floor(rng.next() * 6) + 1));
    const die2 = Math.min(6, Math.max(1, Math.floor(rng.next() * 6) + 1));
    dlog(`[Dice] roll: die1=${die1}, die2=${die2}, total=${die1 + die2}, doubles=${die1 === die2}`);
    this.lastResult = {
      die1,
      die2,
      isDoubles: die1 === die2,
      total: die1 + die2,
    };
    return this.lastResult;
  }

  toJSON() {
    return { lastResult: this.lastResult };
  }
}
