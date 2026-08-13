// This module must stay free of Phaser imports. Everything under game/, tiles/,
// cards/ and utils/ reaches the rules through it, and that is what keeps the
// model runnable — and unit-testable — in plain Node, with no DOM or canvas.
// The Phaser.Game options live in main.ts for the same reason.

// ─── Canvas size ───────────────────────────────────────────────────────────────
// Also consumed by main.ts when building the Phaser config.
export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 800;

// ─── Board geometry ────────────────────────────────────────────────────────────
// Tile *sizes* only. How many tiles there are, how many sit on a side and which
// tile plays which role are all derived from the map — see Board.computeLayout
// and Board.anchor. Nothing may reintroduce a board-length constant here.
export const CORNER_SIZE = 88;
export const TILE_W = 56;
export const TILE_H = 88;
export const BOARD_ORIGIN_X = 80;
export const BOARD_ORIGIN_Y = 40;

// ─── Economy ───────────────────────────────────────────────────────────────────
export const STARTING_CASH = 1500;
export const GO_SALARY = 200;
export const INCOME_TAX = 200;
export const LUXURY_TAX = 100;
export const JAIL_FINE = 50;
export const HOUSE_LIMIT = 32;
export const HOTEL_LIMIT = 12;

// ─── Token names ───────────────────────────────────────────────────────────────
export type TokenType =
  | 'topHat'
  | 'car'
  | 'dog'
  | 'battleship'
  | 'iron'
  | 'boot'
  | 'wheelbarrow'
  | 'thimble';

export const TOKEN_LABELS: Record<TokenType, string> = {
  topHat: 'Top Hat',
  car: 'Car',
  dog: 'Dog',
  battleship: 'Battleship',
  iron: 'Iron',
  boot: 'Boot',
  wheelbarrow: 'Wheelbarrow',
  thimble: 'Thimble',
};

// ─── Color groups ──────────────────────────────────────────────────────────────
export type ColorGroup =
  | 'brown'
  | 'lightBlue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'darkBlue';

// What colour a group is drawn in is a property of the *theme*, not of the
// rules — `theme().groups[group]` in `ui/Theme.ts`. A GROUP_COLORS table lived
// here until M8c and meant every board had to look like the 1935 one.
//
// How many lots a colour group holds is a property of the *map* — ask
// `board.groupTiles(group).length`. A GROUP_SIZES table lived here until M8a and
// quietly described the classic board to every other board.

// ─── House rules ───────────────────────────────────────────────────────────────
// Every flag here is read by something. A fourth, `speedDie`, was declared from
// M1 and removed in M6, because it is not a flag but a variant — a third die,
// two new face effects and an extra step in the turn. It exists now, as
// `registerVariant('speedDie')` in `game/Variants.ts`, and the menu offers it
// beside these switches by asking the registry rather than by listing it here.
export interface HouseRules {
  freeParkingJackpot: boolean; // taxes and fines pool on Free Parking
  doubleGoSalary: boolean;     // $400 for landing exactly on Go
  noAuction: boolean;          // a declined property stays unowned
}

export const DEFAULT_HOUSE_RULES: HouseRules = {
  freeParkingJackpot: false,
  doubleGoSalary: false,
  noAuction: false,
};

export const HOUSE_RULE_LABELS: Record<keyof HouseRules, string> = {
  freeParkingJackpot: 'Free Parking jackpot',
  doubleGoSalary:     'Double salary on GO',
  noAuction:          'No auctions',
};
