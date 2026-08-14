// ─── Rules ────────────────────────────────────────────────────────────────────
// The numbers and switches the classic game hardcodes, gathered into one object a
// map can override and a menu can toggle.
//
// Until M8b these lived as constants in `config.ts` and as literals inside
// `TurnManager` — `doublesStreak >= 3`, `jailTurns >= 3` — which meant a variant
// could not change them without editing the engine. They are read through
// `board.rules` now: a board is built from a map, and a map may bring its own
// economy along with its tiles.

// Type-only, and it has to stay that way: `TurnFlow` imports `Board`, which
// imports this file. Erased at compile time, there is no cycle at runtime.
import type { BuiltInTurnOrder, BuiltInWinCondition } from './TurnFlow';
import type { BuiltInMovement } from './Movement';
import type { BuiltInRollRule } from './RollRules';

export interface GameRules {
  /** What each player starts with. */
  startingCash: number;
  /** Paid for passing the `start` anchor. */
  goSalary: number;
  jailFine: number;
  /** Turns spent in jail before the fine is forced. */
  jailTerm: number;
  /** Consecutive doubles that send a player to jail. */
  doublesToJail: number;
  /**
   * What a roll *means* — `'classic'` is doubles roll again, three go to jail.
   * A named strategy so a rule set can say what a *triple* means; see
   * `game/RollRules.ts`.
   */
  rollRule: BuiltInRollRule | (string & {});
  /** How many houses the bank owns. The supply is deliberately finite. */
  houseLimit: number;
  hotelLimit: number;
  /** Houses a lot needs before it can take a hotel. */
  housesBeforeHotel: number;
  /**
   * Interest on a mortgage, as a fraction. Charged **twice** in the printed
   * game and both are now honoured: once when a mortgaged deed changes hands,
   * and once when it is lifted. Zero turns the whole rule off, which is what the
   * engine did until M10a.
   */
  mortgageInterest: number;
  /**
   * What an unimproved lot charges when its owner holds the whole colour group.
   * Two in the classic rules, and the literal `* 2` it replaced was the last
   * hardcoded rent in the engine.
   */
  monopolyRent: number;
  /**
   * What it charges when the owner holds all *but one* lot of a group of three
   * or more. Off (1) in the classic rules, because a majority is worth nothing
   * there; Ultimate Monopoly pays double for one and triple for the full set.
   */
  majorityRent: number;
  /**
   * Whether a bot may offer *you* a trade, uninvited, on its own turn. Bots have
   * always traded with each other; this is the switch for whether they may
   * interrupt a person, because that is a question about the game's manners
   * rather than about whether the trade is a good one.
   */
  botOffersTrades: boolean;
  /** Rounds a bot waits before interrupting the same person again. */
  botTradeCooldown: number;
  /**
   * Sell a house at auction when more players could buy one than the bank has
   * left. On in the classic rules, because it *is* the classic rule — see
   * `game/Contention.ts`. Off, and turn order decides who gets the last ones.
   */
  houseAuctions: boolean;

  // ── The auction ─────────────────────────────────────────────────────────────
  /** How long each bidder has before the clock passes for them. */
  auctionSeconds: number;
  /** The smallest raise the auction will take. */
  bidIncrement: number;
  /** Raises the panel offers, over the minimum. `[0, 40, 90]` is three buttons:
   *  the minimum bid and two bigger jumps, so bidding is not twenty clicks. */
  bidSteps: number[];

  // ── The turn itself ─────────────────────────────────────────────────────────
  // Named strategies, not functions: a rule set is saved with the game, and a
  // function does not survive `JSON.stringify`. Both are looked up in the
  // registries in `game/TurnFlow.ts`, the same way a tile type is.
  /** Who plays next — `'seat'` is round the table, doubles rolling again. */
  turnOrder: BuiltInTurnOrder | (string & {});
  /**
   * What one step forward means — `'circuit'` is one loop, which is every board
   * that shipped before M11. `'tracks'` walks the loops a map declares and
   * crosses at its junctions; see `game/Movement.ts`.
   */
  movement: BuiltInMovement | (string & {});
  /** When the game is over — `'lastSolvent'` is the classic. */
  winCondition: BuiltInWinCondition | (string & {});
  /** Rounds the `roundLimit` win condition allows. 0 means no limit. */
  roundLimit: number;
  /**
   * Variants switched on, by name — see `game/Variants.ts`. A variant is the
   * rule that is neither a number nor a strategy: different dice, an extra step
   * in the turn, or both. `['speedDie']` is the one that ships.
   */
  variants: string[];

  // ── House rules: switchable from the menu ───────────────────────────────────
  /** Taxes and fines pool on Free Parking instead of going to the bank. */
  freeParkingJackpot: boolean;
  /** Landing exactly on GO pays the salary twice. */
  doubleGoSalary: boolean;
  /** A declined property stays unowned instead of going to auction. */
  noAuction: boolean;
}

export const CLASSIC_RULES: GameRules = {
  startingCash: 1500,
  goSalary: 200,
  jailFine: 50,
  jailTerm: 3,
  doublesToJail: 3,
  rollRule: 'classic',
  houseLimit: 32,
  hotelLimit: 12,
  housesBeforeHotel: 4,
  mortgageInterest: 0.1,
  monopolyRent: 2,
  majorityRent: 1,
  houseAuctions: true,
  botOffersTrades: true,
  botTradeCooldown: 3,
  auctionSeconds: 15,
  bidIncrement: 10,
  bidSteps: [0, 40, 90],

  turnOrder: 'seat',
  movement: 'circuit',
  winCondition: 'lastSolvent',
  roundLimit: 0,
  variants: [],

  freeParkingJackpot: false,
  doubleGoSalary: false,
  noAuction: false,
};

/** The subset a player can switch on before starting a game. */
export type HouseRuleFlag = 'freeParkingJackpot' | 'doubleGoSalary' | 'noAuction';

export const HOUSE_RULE_LABELS: Record<HouseRuleFlag, string> = {
  freeParkingJackpot: 'Free Parking jackpot',
  doubleGoSalary:     'Double salary on GO',
  noAuction:          'No auctions',
};

/** Layer overrides — a map's, then a player's — over the classic rule set. */
export function resolveRules(...overrides: Array<Partial<GameRules> | undefined>): GameRules {
  const resolved = overrides.reduce<GameRules>(
    (rules, layer) => (layer ? { ...rules, ...layer } : rules),
    { ...CLASSIC_RULES },
  );
  // A layer that names variants replaces the list rather than adding to it — a
  // map saying "played with the speed die" is a statement about the whole game.
  // Copied so no rule set ever shares `CLASSIC_RULES.variants` by reference.
  return { ...resolved, variants: [...resolved.variants] };
}
