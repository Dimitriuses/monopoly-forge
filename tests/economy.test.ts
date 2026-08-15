import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { PropertyTile } from '@/tiles/PropertyTile';
import { RailroadTile, UtilityTile } from '@/tiles/SpecialTiles';
import { HOUSE_LIMIT, HOTEL_LIMIT } from '@/config';

const boardOf = () => new Board();
const property = (board: Board, id: number) => board.getTile(id) as PropertyTile;

describe('PropertyTile — rent tiers', () => {
  let board: Board;
  let tile: PropertyTile;

  beforeEach(() => {
    board = boardOf();
    tile = property(board, 1); // Mediterranean Ave, rent [2,10,30,90,160,250]
  });

  it('charges nothing while unowned', () => {
    expect(tile.currentRent).toBe(0);
  });

  it('charges the bare-lot rent once owned', () => {
    tile.ownerId = 'p1';
    expect(tile.currentRent).toBe(2);
  });

  it('steps up the rent with each house', () => {
    tile.ownerId = 'p1';
    const expected = [2, 10, 30, 90, 160];
    expected.forEach((rent, houses) => {
      tile.level = houses;
      expect(tile.currentRent).toBe(rent);
    });
  });

  it('charges the hotel tier regardless of the house counter', () => {
    tile.ownerId = 'p1';
    tile.level = 5;
    tile.level = 0;
    expect(tile.currentRent).toBe(250);
  });

  it('charges nothing while mortgaged, even with a hotel', () => {
    tile.ownerId = 'p1';
    tile.level = 5;
    tile.isMortgaged = true;
    expect(tile.currentRent).toBe(0);
  });

  it('rejects a definition missing its rent data', () => {
    expect(() => new PropertyTile({ id: 99, type: 'property', name: 'Bad' })).toThrow(/missing required/);
  });
});

describe('RailroadTile / UtilityTile rent', () => {
  it('doubles railroad rent for each additional railroad owned', () => {
    const rail = new RailroadTile({ id: 5, type: 'railroad', name: 'Reading', price: 200, mortgage: 100 });
    expect([1, 2, 3, 4].map((n) => rail.rentFor(n))).toEqual([25, 50, 100, 200]);
  });

  it('charges no railroad rent while mortgaged', () => {
    const rail = new RailroadTile({ id: 5, type: 'railroad', name: 'Reading' });
    rail.isMortgaged = true;
    expect(rail.rentFor(4)).toBe(0);
  });

  it('multiplies the dice by 4, or by 10 with both utilities', () => {
    const util = new UtilityTile({ id: 12, type: 'utility', name: 'Electric' });
    expect(util.rentMultiplier(1)).toBe(4);
    expect(util.rentMultiplier(2)).toBe(10);
  });
});

describe('Bank — cash transfers', () => {
  let bank: Bank;
  let ann: Player;
  let bo: Player;

  beforeEach(() => {
    bank = new Bank();
    ann = new Player('p1', 'Ann', 'car');
    bo = new Player('p2', 'Bo', 'dog');
  });

  it('moves the full amount when the debtor can pay', () => {
    bank.transferBetweenPlayers(ann, bo, 300);
    expect(ann.cash).toBe(1200);
    expect(bo.cash).toBe(1800);
  });

  it('hands over everything the debtor has when they cannot pay in full', () => {
    ann.cash = 120;
    bank.transferBetweenPlayers(ann, bo, 500);
    expect(ann.cash).toBe(0);
    expect(bo.cash).toBe(1620);
  });

  it('never drives a balance below zero', () => {
    bank.collectTax(ann, 99_999);
    expect(ann.cash).toBe(0);
  });

  it('conserves total cash across a player-to-player transfer', () => {
    const before = ann.cash + bo.cash;
    bank.transferBetweenPlayers(bo, ann, 745);
    expect(ann.cash + bo.cash).toBe(before);
  });
});

// The Free Parking jackpot house rule: fines and taxes wait in the pot instead
// of vanishing into the bank.
describe('Bank — the Free Parking pot', () => {
  let bank: Bank;
  let ann: Player;

  beforeEach(() => {
    bank = new Bank();
    ann = new Player('p1', 'Ann', 'car');
  });

  it('starts empty and ignores nonsense', () => {
    expect(bank.pot).toBe(0);
    bank.addToPot(0);
    bank.addToPot(-50);
    expect(bank.pot).toBe(0);
  });

  it('accumulates and pays out in full, leaving nothing behind', () => {
    bank.addToPot(200);
    bank.addToPot(50);
    expect(bank.pot).toBe(250);

    expect(bank.takePot(ann)).toBe(250);
    expect(ann.cash).toBe(1750);
    expect(bank.pot).toBe(0);
    expect(bank.takePot(ann)).toBe(0);   // and the next player gets nothing
  });
});

describe('Bank — property purchase', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;

  beforeEach(() => {
    board = boardOf();
    bank = new Bank();
    ann = new Player('p1', 'Ann', 'car');
  });

  it('transfers title and cash on a successful sale', () => {
    const tile = property(board, 39); // Boardwalk, $400
    expect(bank.sellPropertyToPlayer(ann, tile)).toBe(true);
    expect(ann.cash).toBe(1100);
    expect(tile.ownerId).toBe('p1');
    expect(ann.ownedTileIds.has(39)).toBe(true);
  });

  it('refuses a sale the buyer cannot afford', () => {
    const tile = property(board, 39);
    ann.cash = 399;
    expect(bank.sellPropertyToPlayer(ann, tile)).toBe(false);
    expect(tile.ownerId).toBeNull();
    expect(ann.cash).toBe(399);
  });

  it('refuses to sell a tile that already has an owner', () => {
    const tile = property(board, 39);
    tile.ownerId = 'p2';
    expect(bank.sellPropertyToPlayer(ann, tile)).toBe(false);
    expect(ann.cash).toBe(1500);
  });
});

describe('Bank — mortgage', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;
  let tile: PropertyTile;

  beforeEach(() => {
    board = boardOf();
    bank = new Bank();
    ann = new Player('p1', 'Ann', 'car');
    tile = property(board, 1); // mortgage value 30
    tile.ownerId = 'p1';
  });

  it('pays the mortgage value and flags the tile', () => {
    expect(bank.mortgage(ann, tile)).toBe(true);
    expect(ann.cash).toBe(1530);
    expect(tile.isMortgaged).toBe(true);
  });

  it('charges 110% to lift the mortgage', () => {
    bank.mortgage(ann, tile);
    expect(bank.unmortgage(ann, tile)).toBe(true);
    expect(ann.cash).toBe(1530 - 33); // floor(30 * 1.1)
    expect(tile.isMortgaged).toBe(false);
  });

  it('refuses to mortgage a tile the player does not own', () => {
    tile.ownerId = 'p2';
    expect(bank.mortgage(ann, tile)).toBe(false);
    expect(ann.cash).toBe(1500);
  });

  it('refuses to mortgage the same tile twice', () => {
    bank.mortgage(ann, tile);
    expect(bank.mortgage(ann, tile)).toBe(false);
    expect(ann.cash).toBe(1530);
  });
});

describe('Bank — house and hotel inventory', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;
  let tile: PropertyTile;

  beforeEach(() => {
    board = boardOf();
    bank = new Bank();
    ann = new Player('p1', 'Ann', 'car');
    tile = property(board, 1); // houseCost 50
    tile.ownerId = 'p1';
  });

  it('starts with the standard 32 houses and 12 hotels', () => {
    expect(bank.houses).toBe(HOUSE_LIMIT);
    expect(bank.hotels).toBe(HOTEL_LIMIT);
  });

  it('draws each house from the bank stock', () => {
    expect(bank.build(ann, tile)).toBe(true);
    expect(tile.level).toBe(1);
    expect(bank.houses).toBe(31);
    expect(ann.cash).toBe(1450);
  });

  it('caps a lot at four houses', () => {
    for (let i = 0; i < 4; i++) expect(bank.build(ann, tile)).toBe(true);
    expect(bank.build(ann, tile)).toBe(false);
    expect(tile.level).toBe(4);
  });

  it('returns four houses to the bank when a hotel is built', () => {
    for (let i = 0; i < 4; i++) bank.build(ann, tile);
    expect(bank.houses).toBe(28);

    expect(bank.build(ann, tile)).toBe(true);
    expect(tile.level === 5).toBe(true);
    expect(tile.level).toBe(0);
    expect(bank.hotels).toBe(11);
    expect(bank.houses).toBe(32); // the four came back
  });

  it('refuses a hotel before four houses are standing', () => {
    bank.build(ann, tile);
    expect(bank.build(ann, tile)).toBe(false);
  });

  it('refunds half the house cost on a sale and restocks the bank', () => {
    bank.build(ann, tile);
    const cash = ann.cash;
    expect(bank.sell(ann, tile)).toBe(true);
    expect(ann.cash).toBe(cash + 25);
    expect(bank.houses).toBe(32);
    expect(tile.level).toBe(0);
  });

  it('refuses to build when the bank has run out of houses', () => {
    bank.level = 0;
    expect(bank.build(ann, tile)).toBe(false);
    expect(tile.level).toBe(0);
  });

  it('conserves the house supply across a full build-and-sell cycle', () => {
    for (let i = 0; i < 4; i++) bank.build(ann, tile);
    bank.build(ann, tile);
    bank.sell(ann, tile);
    for (let i = 0; i < 4; i++) bank.sell(ann, tile);
    expect(bank.houses).toBe(HOUSE_LIMIT);
    expect(bank.hotels).toBe(HOTEL_LIMIT);
  });
});
