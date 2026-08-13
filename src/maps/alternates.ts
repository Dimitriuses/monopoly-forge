import type { ColorGroup } from '@/config';
import type { TileDefinition } from '@/tiles/Tile';
import type { GameMap } from './GameMap';

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

export const ROUND_MAP: GameMap = {
  id: 'round',
  name: 'Roundabout',
  blurb: '24 tiles on a single circle — no corners at all',
  tiles: ROUND_TILES,
  layout: { kind: 'ring', depth: 70 },
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
};
