import type { TokenType } from '@/config';
import { CLASSIC_RULES } from './Rules';
import type { Card } from '@/cards/CardDeck';

export class Player {
  readonly id: string;
  readonly name: string;
  readonly token: TokenType;

  cash: number;
  position: number;        // board index, 0 … board.size - 1
  inJail: boolean;
  jailTurns: number;       // consecutive turns spent in jail (0–3)
  /** The actual Get Out of Jail Free cards held, so spending one can return it
   *  to the deck it came from rather than withdrawing it from the game. */
  jailCards: Card[];
  ownedTileIds: Set<number>;
  isBankrupt: boolean;
  doublesStreak: number;   // consecutive doubles this turn (resets on non-double or jail)
  /** Whether a bot takes this seat's turns. Part of the game, so it is saved. */
  isBot: boolean;
  /**
   * Things a *game* gave this player that the engine has no word for — travel
   * vouchers, stock certificates. Countable and keyed by kind; see
   * `game/Holdings.ts`, and use its helpers rather than writing here directly,
   * because a kind may have a limit.
   */
  holdings: Record<string, number>;

  constructor(
    id: string, name: string, token: TokenType,
    isBot = false, startingCash: number = CLASSIC_RULES.startingCash,
  ) {
    this.id = id;
    this.name = name;
    this.token = token;
    this.cash = startingCash;
    this.position = 0;
    this.inJail = false;
    this.jailTurns = 0;
    this.jailCards = [];
    this.ownedTileIds = new Set();
    this.isBankrupt = false;
    this.doublesStreak = 0;
    this.isBot = isBot;
    this.holdings = {};
  }

  get getOutOfJailCards(): number {
    return this.jailCards.length;
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
      isBot: this.isBot,
    };
  }
}
