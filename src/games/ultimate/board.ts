import { CLASSIC_MAP } from '@/maps/classic';
import type { GameMap } from '@/maps';
import type { ColorGroup } from '@/config';
import type { TileDefinition } from '@/tiles/Tile';

// ─── The Ultimate Monopoly board ──────────────────────────────────────────────
// 120 tiles in **three loops**, joined at four junctions — the first board in
// this repo that is not one circuit, and the reason `game/Movement.ts` exists.
//
//   * **middle** (0–39) — Classic Monopoly, almost untouched. Its four corners
//     move, because the functions they carry are spread across all three tracks
//     so that none is duplicated: GO stays, Jail takes Free Parking's corner,
//     Roll Three takes Jail's, Squeeze Play takes Go To Jail's.
//   * **outer** (40–95) — thirteen spaces a side, eight new colour groups, four
//     cab companies and four new utilities.
//   * **inner** (96–119) — five a side, four groups of three, and the corner
//     functions that had nowhere else to go.
//
// **A junction is one space.** A railroad and the transit station beside it are
// the same square in the printed rules, and here they are two tiles joined by a
// `junction`: step off either with an even roll and you continue from the other,
// which is exactly "an even roll that takes you *past* a transit station rides
// it to the opposite track". Two junctions join outer to middle, two join middle
// to inner — so the only way between outer and inner is a Holland Tunnel.
//
// The order of the tracks in the tile list is not arbitrary: **GO has to be tile
// 0**, because `Player` starts there and `TurnManager` sanitises a corrupt
// position to it. That is why the middle track is laid down first even though it
// is drawn second.

/**
 * Rent that scales off the price, the same scheme the alternate maps use. The
 * printed game puts these on 64 title deeds that are not in the reference, so
 * they are derived rather than invented one by one — consistent is worth more
 * than a guess at somebody else's table.
 */
function lot(
  id: number, name: string, group: ColorGroup, price: number, houseCost: number,
): TileDefinition {
  const base = Math.max(2, Math.round(price / 12));
  return {
    id, type: 'property', name, group, price, houseCost,
    mortgage: Math.round(price / 2),
    rent: [base, base * 5, base * 15, base * 45, base * 62, base * 75],
  };
}

const cab = (id: number, name: string): TileDefinition =>
  ({ id, type: 'cabCompany', name, price: 300, mortgage: 150 });

const util = (id: number, name: string): TileDefinition =>
  ({ id, type: 'utility', name, price: 150, mortgage: 75 });

// ─── Middle: Classic, with its corners redistributed ──────────────────────────

/** Classic tile ids whose square does something else here. */
const MIDDLE_SWAPS: Record<number, TileDefinition> = {
  // The two railroads that moved outward. Their deeds are on the outer track;
  // what is left here is the transit station half of the junction.
  5:  { id: 5,  type: 'transit', name: 'Transit Station' },
  25: { id: 25, type: 'transit', name: 'Transit Station' },
  // Free Parking went to the outer track, so Jail takes its corner…
  10: { id: 10, type: 'rollThree',   name: 'Roll Three' },
  20: { id: 20, type: 'jail',        name: 'Jail / Just Visiting' },
  // …and Go To Jail went to the inner track, so Squeeze Play takes its.
  30: { id: 30, type: 'squeezePlay', name: 'Squeeze Play' },
};

const MIDDLE: TileDefinition[] = CLASSIC_MAP.tiles.map(
  (tile, i) => MIDDLE_SWAPS[i] ?? { ...tile, id: i },
);

// ─── Outer: thirteen a side ───────────────────────────────────────────────────
// Counter-clockwise from Free Parking in the bottom-right, the same way round as
// the middle track. Prices climb $30 every two lots, which is the printed
// board's own scheme; the two groups of three are where it breaks.

const OUTER: TileDefinition[] = [
  { id: 40, type: 'freeParking', name: 'Free Parking' },

  lot(41, 'Lake Street',      'minneapolis', 30, 50),
  { id: 42, type: 'communityChest', name: 'Community Chest' },
  lot(43, 'Nicollet Avenue',  'minneapolis', 30, 50),
  lot(44, 'Hennepin Avenue',  'minneapolis', 60, 50),
  { id: 45, type: 'busTicket', name: 'Bus Ticket' },
  cab(46, 'Checker Cab Co.'),
  { id: 47, type: 'railroad', name: 'Reading Railroad', price: 200, mortgage: 100 },
  lot(48, 'Esplanade Avenue', 'newOrleans', 90, 50),
  lot(49, 'Canal Street',     'newOrleans', 90, 50),
  { id: 50, type: 'chance', name: 'Chance' },
  util(51, 'Cable Company'),
  lot(52, 'Magazine Street',  'newOrleans', 120, 50),
  lot(53, 'Bourbon Street',   'newOrleans', 120, 50),

  { id: 54, type: 'tunnel', name: 'Holland Tunnel' },

  { id: 55, type: 'auctionAny', name: 'Auction' },
  lot(56, 'Katy Freeway',        'houston', 150, 100),
  lot(57, 'Westheimer Road',     'houston', 150, 100),
  util(58, 'Internet Service Provider'),
  lot(59, 'Kirby Drive',         'houston', 180, 100),
  lot(60, 'Cullen Boulevard',    'houston', 180, 100),
  { id: 61, type: 'chance', name: 'Chance' },
  cab(62, 'Black & White Cab Co.'),
  lot(63, 'DeKalb Avenue',       'atlanta', 210, 100),
  { id: 64, type: 'communityChest', name: 'Community Chest' },
  lot(65, 'Andrew Young Intl Blvd', 'atlanta', 210, 100),
  lot(66, 'Decatur Street',      'atlanta', 240, 100),
  lot(67, 'Peachtree Street',    'atlanta', 240, 100),

  { id: 68, type: 'payDay', name: 'Pay Day' },

  lot(69, 'Randolph Street',   'chicago', 270, 150),
  { id: 70, type: 'chance', name: 'Chance' },
  lot(71, 'Lake Shore Drive',  'chicago', 270, 150),
  lot(72, 'Wacker Drive',      'chicago', 300, 150),
  lot(73, 'Michigan Avenue',   'chicago', 300, 150),
  cab(74, 'Yellow Cab Co.'),
  { id: 75, type: 'railroad', name: 'B&O Railroad', price: 200, mortgage: 100 },
  { id: 76, type: 'communityChest', name: 'Community Chest' },
  lot(77, 'South Temple',      'saltLake', 330, 150),
  lot(78, 'West Temple',       'saltLake', 330, 150),
  util(79, 'Trash Collector'),
  lot(80, 'North Temple',      'saltLake', 360, 150),
  lot(81, 'Temple Square',     'saltLake', 360, 150),

  { id: 82, type: 'subway', name: 'Subway' },

  lot(83, 'South Street',      'philadelphia', 390, 200),
  lot(84, 'Broad Street',      'philadelphia', 390, 200),
  lot(85, 'Walnut Street',     'philadelphia', 420, 200),
  { id: 86, type: 'communityChest', name: 'Community Chest' },
  lot(87, 'Market Street',     'philadelphia', 420, 200),
  { id: 88, type: 'busTicket', name: 'Bus Ticket' },
  util(89, 'Sewage System'),
  cab(90, 'Ute Cab Co.'),
  { id: 91, type: 'birthdayGift', name: 'Birthday Gift' },
  lot(92, 'Mulholland Drive',  'losAngeles', 450, 200),
  lot(93, 'Ventura Boulevard', 'losAngeles', 480, 200),
  { id: 94, type: 'chance', name: 'Chance' },
  lot(95, 'Rodeo Drive',       'losAngeles', 510, 200),
];

// ─── Inner: five a side ───────────────────────────────────────────────────────

const INNER: TileDefinition[] = [
  { id: 96, type: 'goToJail', name: 'Go To Jail' },

  lot(97,  'The Embarcadero',   'sanFrancisco', 210, 200),
  lot(98,  "Fisherman's Wharf", 'sanFrancisco', 250, 200),
  util(99, 'Telephone Company'),
  { id: 100, type: 'communityChest', name: 'Community Chest' },
  lot(101, 'Beacon Street',     'boston', 330, 250),

  { id: 102, type: 'bonus', name: 'Bonus' },

  lot(103, 'Boylston Street',   'boston', 330, 250),
  lot(104, 'Newbury Street',    'boston', 380, 250),
  { id: 105, type: 'transit', name: 'Transit Station' },
  lot(106, 'Fifth Avenue',      'newYork', 430, 300),
  lot(107, 'Madison Avenue',    'newYork', 430, 300),

  { id: 108, type: 'stockExchange', name: 'Stock Exchange' },

  lot(109, 'Wall Street',       'newYork', 500, 300),
  { id: 110, type: 'taxRefund', name: 'Tax Refund' },
  util(111, 'Gas Company'),
  { id: 112, type: 'chance', name: 'Chance' },
  lot(113, 'Florida Avenue',    'miami', 130, 150),

  { id: 114, type: 'tunnel', name: 'Holland Tunnel' },

  lot(115, 'Miami Avenue',      'miami', 130, 150),
  lot(116, 'Biscayne Avenue',   'miami', 150, 150),
  { id: 117, type: 'transit', name: 'Transit Station' },
  { id: 118, type: 'reverse', name: 'Reverse Direction' },
  lot(119, 'Lombard Street',    'sanFrancisco', 210, 200),
];

// ─── The map ──────────────────────────────────────────────────────────────────

export const ULTIMATE_MAP: GameMap = {
  id: 'ultimate',
  name: 'Ultimate',
  blurb: '120 tiles across three tracks, joined by transit stations',
  tiles: [...MIDDLE, ...OUTER, ...INNER],

  tracks: [
    { id: 'middle', from: 0,  count: 40 },
    { id: 'outer',  from: 40, count: 56 },
    { id: 'inner',  from: 96, count: 24 },
  ],

  // A railroad and the transit station beside it, on adjacent tracks. Two joins
  // outer to middle, two join middle to inner — deliberately none joins outer to
  // inner, which is the only reason the Holland Tunnels are worth anything.
  junctions: [
    { a: 47, b: 5 },     // Reading Railroad      ↔ middle, bottom
    { a: 75, b: 25 },    // B&O Railroad          ↔ middle, top
    { a: 15, b: 105 },   // Pennsylvania Railroad ↔ inner, left
    { a: 35, b: 117 },   // Short Line            ↔ inner, right
  ],

  // Three nested squares, like the board this is a copy of. The array is in
  // *tile* order — middle first, because GO has to be tile 0 — and `inset` is
  // what puts each one where it belongs, so the two orders stay independent.
  layout: {
    kind: 'squares',
    depth: 60,
    rings: [
      { count: 40, inset: 60 },    // middle: 9 a side, the classic board
      { count: 56, inset: 0 },     // outer:  13 a side
      { count: 24, inset: 120 },   // inner:  5 a side
    ],
  },
};

/** The two Holland Tunnels, for the tile effect that jumps between them. */
export const TUNNELS = [54, 114] as const;
