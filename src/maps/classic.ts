import type { TileDefinition } from '@/tiles/Tile';
import type { GameMap } from './GameMap';

// ─── The classic board ────────────────────────────────────────────────────────
// The Atlantic City circuit the whole project was built to express: 40 tiles in a
// square, four corners, eight colour groups. It lived in `config.ts` until M8a,
// which is the point at which "the classic board" and "the board" stopped being
// the same thing.

const TILES: TileDefinition[] = [
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

export const CLASSIC_MAP: GameMap = {
  id: 'classic',
  name: 'Classic',
  blurb: '40 tiles, four corners, eight colour groups',
  tiles: TILES,
  layout: { kind: 'square' },
};
