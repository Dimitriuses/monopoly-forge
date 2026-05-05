import type { TokenType } from '@/config';
import { STARTING_CASH } from '@/config';

export class Player {
  readonly id: string;
  readonly name: string;
  readonly token: TokenType;

  cash: number;
  position: number;        // board index 0–39
  inJail: boolean;
  jailTurns: number;       // consecutive turns spent in jail (0–3)
  getOutOfJailCards: number;
  ownedTileIds: Set<number>;
  isBankrupt: boolean;
  doublesStreak: number;   // consecutive doubles this turn (resets on non-double or jail)

  constructor(id: string, name: string, token: TokenType) {
    this.id = id;
    this.name = name;
    this.token = token;
    this.cash = STARTING_CASH;
    this.position = 0;
    this.inJail = false;
    this.jailTurns = 0;
    this.getOutOfJailCards = 0;
    this.ownedTileIds = new Set();
    this.isBankrupt = false;
    this.doublesStreak = 0;
  }

  get netWorth(): number {
    // Full net worth calculation requires access to Board — approximated here.
    // GameScene/Bank will compute properly using tile data.
    return this.cash;
  }

  canAfford(amount: number): boolean {
    return this.cash >= amount;
  }

  pay(amount: number): void {
    this.cash = Math.max(0, this.cash - amount);
  }

  receive(amount: number): void {
    this.cash += amount;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      token: this.token,
      cash: this.cash,
      position: this.position,
      inJail: this.inJail,
      jailTurns: this.jailTurns,
      getOutOfJailCards: this.getOutOfJailCards,
      ownedTileIds: [...this.ownedTileIds],
      isBankrupt: this.isBankrupt,
    };
  }
}
