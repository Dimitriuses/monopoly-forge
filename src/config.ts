import type { TileDefinition } from '@/tiles/Tile';

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

export const GROUP_COLORS: Record<ColorGroup, number> = {
  brown:    0x8b4513,
  lightBlue:0x87ceeb,
  pink:     0xff69b4,
  orange:   0xff8c00,
  red:      0xdc143c,
  yellow:   0xffd700,
  green:    0x228b22,
  darkBlue: 0x00008b,
};

export const GROUP_SIZES: Record<ColorGroup, number> = {
  brown: 2, lightBlue: 3, pink: 3, orange: 3,
  red: 3, yellow: 3, green: 3, darkBlue: 2,
};

// ─── Board tile definitions (40 tiles, index 0 = Go) ──────────────────────────
export const BOARD_TILES: TileDefinition[] = [
  { id: 0,  type: 'go',              name: 'GO' },
  { id: 1,  type: 'property',        name: 'Mediterranean Ave',  group: 'brown',    price: 60,  houseCost: 50,  mortgage: 30,  rent: [2,10,30,90,160,250] },
  { id: 2,  type: 'communityChest',  name: 'Community Chest' },
  { id: 3,  type: 'property',        name: 'Baltic Ave',         group: 'brown',    price: 60,  houseCost: 50,  mortgage: 30,  rent: [4,20,60,180,320,450] },
  { id: 4,  type: 'tax',             name: 'Income Tax',         amount: 200 },
  { id: 5,  type: 'railroad',        name: 'Reading Railroad',   price: 200, mortgage: 100 },
  { id: 6,  type: 'property',        name: 'Oriental Ave',       group: 'lightBlue',price: 100, houseCost: 50,  mortgage: 50,  rent: [6,30,90,270,400,550] },
  { id: 7,  type: 'chance',          name: 'Chance' },
  { id: 8,  type: 'property',        name: 'Vermont Ave',        group: 'lightBlue',price: 100, houseCost: 50,  mortgage: 50,  rent: [6,30,90,270,400,550] },
  { id: 9,  type: 'property',        name: 'Connecticut Ave',    group: 'lightBlue',price: 120, houseCost: 50,  mortgage: 60,  rent: [8,40,100,300,450,600] },
  { id: 10, type: 'jail',            name: 'Jail / Just Visiting' },
  { id: 11, type: 'property',        name: 'St. Charles Place',  group: 'pink',     price: 140, houseCost: 100, mortgage: 70,  rent: [10,50,150,450,625,750] },
  { id: 12, type: 'utility',         name: 'Electric Company',   price: 150, mortgage: 75 },
  { id: 13, type: 'property',        name: 'States Ave',         group: 'pink',     price: 140, houseCost: 100, mortgage: 70,  rent: [10,50,150,450,625,750] },
  { id: 14, type: 'property',        name: 'Virginia Ave',       group: 'pink',     price: 160, houseCost: 100, mortgage: 80,  rent: [12,60,180,500,700,900] },
  { id: 15, type: 'railroad',        name: 'Pennsylvania Railroad', price: 200, mortgage: 100 },
  { id: 16, type: 'property',        name: 'St. James Place',    group: 'orange',   price: 180, houseCost: 100, mortgage: 90,  rent: [14,70,200,550,750,950] },
  { id: 17, type: 'communityChest',  name: 'Community Chest' },
  { id: 18, type: 'property',        name: 'Tennessee Ave',      group: 'orange',   price: 180, houseCost: 100, mortgage: 90,  rent: [14,70,200,550,750,950] },
  { id: 19, type: 'property',        name: 'New York Ave',       group: 'orange',   price: 200, houseCost: 100, mortgage: 100, rent: [16,80,220,600,800,1000] },
  { id: 20, type: 'freeParking',     name: 'Free Parking' },
  { id: 21, type: 'property',        name: 'Kentucky Ave',       group: 'red',      price: 220, houseCost: 150, mortgage: 110, rent: [18,90,250,700,875,1050] },
  { id: 22, type: 'chance',          name: 'Chance' },
  { id: 23, type: 'property',        name: 'Indiana Ave',        group: 'red',      price: 220, houseCost: 150, mortgage: 110, rent: [18,90,250,700,875,1050] },
  { id: 24, type: 'property',        name: 'Illinois Ave',       group: 'red',      price: 240, houseCost: 150, mortgage: 120, rent: [20,100,300,750,925,1100] },
  { id: 25, type: 'railroad',        name: 'B&O Railroad',       price: 200, mortgage: 100 },
  { id: 26, type: 'property',        name: 'Atlantic Ave',       group: 'yellow',   price: 260, houseCost: 150, mortgage: 130, rent: [22,110,330,800,975,1150] },
  { id: 27, type: 'property',        name: 'Ventnor Ave',        group: 'yellow',   price: 260, houseCost: 150, mortgage: 130, rent: [22,110,330,800,975,1150] },
  { id: 28, type: 'utility',         name: 'Water Works',        price: 150, mortgage: 75 },
  { id: 29, type: 'property',        name: 'Marvin Gardens',     group: 'yellow',   price: 280, houseCost: 150, mortgage: 140, rent: [24,120,360,850,1025,1200] },
  { id: 30, type: 'goToJail',        name: 'Go to Jail' },
  { id: 31, type: 'property',        name: 'Pacific Ave',        group: 'green',    price: 300, houseCost: 200, mortgage: 150, rent: [26,130,390,900,1100,1275] },
  { id: 32, type: 'property',        name: 'North Carolina Ave', group: 'green',    price: 300, houseCost: 200, mortgage: 150, rent: [26,130,390,900,1100,1275] },
  { id: 33, type: 'communityChest',  name: 'Community Chest' },
  { id: 34, type: 'property',        name: 'Pennsylvania Ave',   group: 'green',    price: 320, houseCost: 200, mortgage: 160, rent: [28,150,450,1000,1200,1400] },
  { id: 35, type: 'railroad',        name: 'Short Line Railroad',price: 200, mortgage: 100 },
  { id: 36, type: 'chance',          name: 'Chance' },
  { id: 37, type: 'property',        name: 'Park Place',         group: 'darkBlue', price: 350, houseCost: 200, mortgage: 175, rent: [35,175,500,1100,1300,1500] },
  { id: 38, type: 'tax',             name: 'Luxury Tax',         amount: 100 },
  { id: 39, type: 'property',        name: 'Boardwalk',          group: 'darkBlue', price: 400, houseCost: 200, mortgage: 200, rent: [50,200,600,1400,1700,2000] },
];

// ─── House rules ───────────────────────────────────────────────────────────────
// Every flag here is read by something. A fourth, `speedDie`, was declared from
// M1 and removed in M6: it is not a flag but a variant — a third die, two new
// face effects and a changed turn structure — and belongs with the registrable
// rule sets in ROADMAP M8b rather than as a boolean nothing consults.
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
