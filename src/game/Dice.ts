import { rng } from '@/utils/PRNG';
import { dlog } from '@/utils/log';

export interface DiceResult {
  die1: number;
  die2: number;
  isDoubles: boolean;
  total: number;
}

export class Dice {
  lastResult: DiceResult | null = null;

  roll(): DiceResult {
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
