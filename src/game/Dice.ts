import { rng } from '@/utils/PRNG';

export interface DiceResult {
  die1: number;
  die2: number;
  isDoubles: boolean;
  total: number;
}

export class Dice {
  lastResult: DiceResult | null = null;

  roll(): DiceResult {
    const die1 = rng.int(1, 6);
    const die2 = rng.int(1, 6);
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
