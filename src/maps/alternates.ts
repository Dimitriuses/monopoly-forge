import type { ColorGroup } from '@/config';
import type { TileDefinition } from '@/tiles/Tile';
import type { GameMap } from './GameMap';
import type { Card } from '@/cards/CardDeck';

// ─── Alternative boards ───────────────────────────────────────────────────────
// Maps that are not 40 tiles in a square, which is the whole point of M8a: they
// exist to prove the rules and the renderer take their shape from the map. Both
// are playable — the same rules, the same bots, the same save format.
//
// They are also the cheapest regression test there is for a geometry change: if
// a tile lands in the wrong place on a circle, you can see it.

/**
 * Rent that scales off the price, so a made-up board still plays sensibly.
 * `houseCost` is passed in rather than derived: every lot in a colour group has
 * to charge the same to build, and `validateMap` refuses a map where they differ.
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

// ─── Roundabout: one ring, no corners ─────────────────────────────────────────

const ROUND_TILES: TileDefinition[] = [
  { id: 0, type: 'go', name: 'GO' },
  lot(1, 'Quay One', 'lightBlue', 80, 50),
  lot(2, 'Quay Two', 'lightBlue', 90, 50),
  { id: 3, type: 'chance', name: 'Chance' },
  lot(4, 'Mill Row', 'brown', 110, 50),
  lot(5, 'Mill End', 'brown', 120, 50),
  { id: 6, type: 'railroad', name: 'North Halt', price: 200, mortgage: 100 },
  { id: 7, type: 'jail', name: 'Jail' },
  lot(8, 'Foundry St', 'orange', 150, 100),
  lot(9, 'Forge Lane', 'orange', 160, 100),
  { id: 10, type: 'communityChest', name: 'Community Chest' },
  lot(11, 'Anvil Way', 'orange', 170, 100),
  { id: 12, type: 'utility', name: 'Waterworks', price: 150, mortgage: 75 },
  { id: 13, type: 'tax', name: 'Toll', amount: 100 },
  lot(14, 'Kiln Court', 'red', 200, 100),
  lot(15, 'Kiln Yard', 'red', 210, 100),
  { id: 16, type: 'railroad', name: 'South Halt', price: 200, mortgage: 100 },
  { id: 17, type: 'freeParking', name: 'Free Parking' },
  lot(18, 'Crown Walk', 'green', 260, 150),
  lot(19, 'Crown Rise', 'green', 280, 150),
  { id: 20, type: 'chance', name: 'Chance' },
  { id: 21, type: 'goToJail', name: 'Go to Jail' },
  lot(22, 'Summit Row', 'darkBlue', 320, 200),
  lot(23, 'Summit End', 'darkBlue', 360, 200),
];

/**
 * A deck for a board that is not the classic one. Every card here is
 * *map-agnostic* — it moves you relative to where you are, or moves money —
 * because "advance to Boardwalk" means nothing on a board with no Boardwalk.
 * Shared by both alternative maps.
 */
const GENERIC_CHANCE: Card[] = [
  { id: 'gch1',  description: 'Advance to GO. Collect your salary.',        action: { type: 'advanceToGo' } },
  { id: 'gch2',  description: 'Advance to the nearest Railroad. Pay double rent.', action: { type: 'advanceToNearest', kind: 'railroad' } },
  { id: 'gch3',  description: 'Go back three spaces.',                      action: { type: 'goBack', spaces: 3 } },
  { id: 'gch4',  description: 'Go directly to Jail.',                       action: { type: 'goToJail' } },
  { id: 'gch5',  description: 'Bank pays you a dividend of $50.',           action: { type: 'collectFromBank', amount: 50 } },
  { id: 'gch6',  description: 'Get Out of Jail Free.',   isGetOutOfJail: true, action: { type: 'getOutOfJail' } },
  { id: 'gch7',  description: 'Pay a fine of $25.',                         action: { type: 'payBank', amount: 25 } },
  { id: 'gch8',  description: 'General repairs: $25 per house, $100 per hotel.', action: { type: 'repairs', houseCost: 25, hotelCost: 100 } },
  { id: 'gch9',  description: 'You have been elected chairman: pay each player $50.', action: { type: 'payAll', amount: 50 } },
  { id: 'gch10', description: 'Your loan matures: collect $150.',           action: { type: 'collectFromBank', amount: 150 } },
];

const GENERIC_CHEST: Card[] = [
  { id: 'gcc1',  description: 'Advance to GO. Collect your salary.',        action: { type: 'advanceToGo' } },
  { id: 'gcc2',  description: 'Bank error in your favour: collect $200.',   action: { type: 'collectFromBank', amount: 200 } },
  { id: 'gcc3',  description: "Doctor's fees: pay $50.",                    action: { type: 'payBank', amount: 50 } },
  { id: 'gcc4',  description: 'Get Out of Jail Free.',   isGetOutOfJail: true, action: { type: 'getOutOfJail' } },
  { id: 'gcc5',  description: 'Go directly to Jail.',                       action: { type: 'goToJail' } },
  { id: 'gcc6',  description: "It's your birthday: collect $10 from each player.", action: { type: 'collectFromAll', amount: 10 } },
  { id: 'gcc7',  description: 'Pay hospital fees: $100.',                   action: { type: 'payBank', amount: 100 } },
  { id: 'gcc8',  description: 'You inherit $100.',                          action: { type: 'collectFromBank', amount: 100 } },
  { id: 'gcc9',  description: 'Street repairs: $40 per house, $115 per hotel.', action: { type: 'repairs', houseCost: 40, hotelCost: 115 } },
  { id: 'gcc10', description: 'Receive a consultancy fee of $25.',          action: { type: 'collectFromBank', amount: 25 } },
];

export const ROUND_MAP: GameMap = {
  id: 'round',
  name: 'Roundabout',
  blurb: '24 tiles on a single circle — no corners at all',
  tiles: ROUND_TILES,
  layout: { kind: 'ring', depth: 70 },
  cards: { chance: GENERIC_CHANCE, community: GENERIC_CHEST },
  // A shorter circuit comes round faster, so the salary is smaller.
  rules: { goSalary: 150, startingCash: 1200 },
};

// ─── Orbits: three concentric rings ───────────────────────────────────────────
// The circuit is still one loop — 0 → 29 → 0. The rings are how it is *drawn*,
// so the walk spirals inward and jumps back out to GO, which looks exactly as
// odd as it sounds and is precisely why it is a good test.

const ORBIT_TILES: TileDefinition[] = [
  { id: 0, type: 'go', name: 'GO' },
  lot(1, 'Outer One', 'brown', 60, 50),
  lot(2, 'Outer Two', 'brown', 70, 50),
  { id: 3, type: 'communityChest', name: 'Community Chest' },
  lot(4, 'Rim Walk', 'lightBlue', 100, 50),
  lot(5, 'Rim Row', 'lightBlue', 110, 50),
  { id: 6, type: 'railroad', name: 'Outer Line', price: 200, mortgage: 100 },
  lot(7, 'Rim End', 'lightBlue', 120, 50),
  { id: 8, type: 'tax', name: 'Orbit Tax', amount: 150 },
  lot(9, 'Ring Road', 'pink', 140, 100),
  { id: 10, type: 'chance', name: 'Chance' },
  lot(11, 'Ring Gate', 'pink', 150, 100),

  { id: 12, type: 'jail', name: 'Jail' },
  lot(13, 'Middle Way', 'orange', 180, 100),
  lot(14, 'Middle Row', 'orange', 190, 100),
  { id: 15, type: 'utility', name: 'Power Ring', price: 150, mortgage: 75 },
  lot(16, 'Middle End', 'orange', 200, 100),
  { id: 17, type: 'communityChest', name: 'Community Chest' },
  lot(18, 'Inner Belt', 'red', 220, 150),
  lot(19, 'Inner Bend', 'red', 240, 150),
  { id: 20, type: 'railroad', name: 'Inner Line', price: 200, mortgage: 100 },

  { id: 21, type: 'freeParking', name: 'Free Parking' },
  lot(22, 'Core Walk', 'yellow', 260, 150),
  lot(23, 'Core Rise', 'yellow', 280, 150),
  { id: 24, type: 'chance', name: 'Chance' },
  { id: 25, type: 'goToJail', name: 'Go to Jail' },
  lot(26, 'Apex Row', 'green', 300, 200),
  lot(27, 'Apex End', 'green', 320, 200),
  lot(28, 'Vault Row', 'darkBlue', 360, 200),
  lot(29, 'The Centre', 'darkBlue', 400, 200),
];

export const ORBIT_MAP: GameMap = {
  id: 'orbits',
  name: 'Orbits',
  blurb: '30 tiles across three concentric rings',
  tiles: ORBIT_TILES,
  layout: {
    kind: 'rings',
    depth: 62,
    rings: [
      { count: 12, radius: 272 },
      { count: 9,  radius: 188 },
      { count: 9,  radius: 104 },
    ],
  },
  cards: { chance: GENERIC_CHANCE, community: GENERIC_CHEST },
  // Fewer houses to go round, so a monopoly is worth more and the race is
  // tighter — a rule set is part of a board's design, not a global constant.
  rules: { startingCash: 1400, houseLimit: 24, hotelLimit: 8 },
};
