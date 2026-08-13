// ─── Rules ────────────────────────────────────────────────────────────────────
// The numbers and switches the classic game hardcodes, gathered into one object a
// map can override and a menu can toggle.
//
// Until M8b these lived as constants in `config.ts` and as literals inside
// `TurnManager` — `doublesStreak >= 3`, `jailTurns >= 3` — which meant a variant
// could not change them without editing the engine. They are read through
// `board.rules` now: a board is built from a map, and a map may bring its own
// economy along with its tiles.

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
  /** How many houses the bank owns. The supply is deliberately finite. */
  houseLimit: number;
  hotelLimit: number;
  /** Houses a lot needs before it can take a hotel. */
  housesBeforeHotel: number;

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
  houseLimit: 32,
  hotelLimit: 12,
  housesBeforeHotel: 4,

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
  return overrides.reduce<GameRules>(
    (rules, layer) => (layer ? { ...rules, ...layer } : rules),
    { ...CLASSIC_RULES },
  );
}
