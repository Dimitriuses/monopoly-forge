import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';
import {
  buildingLevel, ownsWholeGroup, groupBuildingCount,
  canBuildHouse, canBuildHotel, canSellHouse, canSellHotel,
  canMortgage, canUnmortgage, unmortgageCost,
} from '@/game/BuildRules';

// Brown is the smallest group: Mediterranean (1) and Baltic (3), $50 a house.
const MEDITERRANEAN = 1;
const BALTIC = 3;
const READING_RAILROAD = 5;

describe('BuildRules — colour-group ownership', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;
  let med: PropertyTile;
  let baltic: PropertyTile;

  const give = (player: Player, ...ids: number[]) => {
    ids.forEach((id) => {
      const tile = board.getTile(id) as PropertyTile;
      tile.ownerId = player.id;
      player.ownedTileIds.add(id);
    });
  };

  beforeEach(() => {
    board  = new Board();
    bank   = new Bank();
    ann    = new Player('p1', 'Ann', 'car');
    med    = board.getTile(MEDITERRANEAN) as PropertyTile;
    baltic = board.getTile(BALTIC) as PropertyTile;
  });

  it('refuses to build on a lot the player does not own', () => {
    give(ann, BALTIC);
    const check = canBuildHouse(board, bank, ann, med);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/not yours/);
  });

  it('refuses to build until the whole colour group is owned', () => {
    give(ann, MEDITERRANEAN);
    const check = canBuildHouse(board, bank, ann, med);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/every lot in the colour group/i);
  });

  it('allows building once the group is complete', () => {
    give(ann, MEDITERRANEAN, BALTIC);
    expect(ownsWholeGroup(board, ann, med)).toBe(true);
    expect(canBuildHouse(board, bank, ann, med).ok).toBe(true);
  });

  it('does not count a group owned by two different players', () => {
    const bo = new Player('p2', 'Bo', 'dog');
    give(ann, MEDITERRANEAN);
    give(bo, BALTIC);
    expect(ownsWholeGroup(board, ann, med)).toBe(false);
  });

  it('refuses to build while any lot in the group is mortgaged', () => {
    give(ann, MEDITERRANEAN, BALTIC);
    baltic.isMortgaged = true;
    const check = canBuildHouse(board, bank, ann, med);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/mortgaged/);
  });
});

describe('BuildRules — even building', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;
  let med: PropertyTile;
  let baltic: PropertyTile;

  beforeEach(() => {
    board  = new Board();
    bank   = new Bank();
    ann    = new Player('p1', 'Ann', 'car');
    med    = board.getTile(MEDITERRANEAN) as PropertyTile;
    baltic = board.getTile(BALTIC) as PropertyTile;
    [med, baltic].forEach((t) => { t.ownerId = ann.id; ann.ownedTileIds.add(t.id); });
  });

  it('blocks a second house on a lot while its neighbour has none', () => {
    med.houses = 1;
    const check = canBuildHouse(board, bank, ann, med);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/within one of each other/);
    expect(canBuildHouse(board, bank, ann, baltic).ok).toBe(true);
  });

  it('lets the group climb one level at a time', () => {
    for (let level = 1; level <= 4; level++) {
      expect(canBuildHouse(board, bank, ann, med).ok).toBe(true);
      med.houses = level;
      expect(canBuildHouse(board, bank, ann, baltic).ok).toBe(true);
      baltic.houses = level;
    }
    expect(canBuildHouse(board, bank, ann, med).ok).toBe(false); // four is the cap
  });

  it('requires four houses on every lot before a hotel goes up', () => {
    med.houses = 4;
    baltic.houses = 3;
    const check = canBuildHotel(board, bank, ann, med);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/needs 4 houses/i);

    baltic.houses = 4;
    expect(canBuildHotel(board, bank, ann, med).ok).toBe(true);
  });

  it('refuses a hotel before four houses stand on the lot itself', () => {
    med.houses = 3;
    baltic.houses = 4;
    expect(canBuildHotel(board, bank, ann, med).ok).toBe(false);
  });

  it('takes houses down evenly too', () => {
    med.houses = 2;
    baltic.houses = 1;
    expect(canSellHouse(board, ann, baltic).ok).toBe(false);
    expect(canSellHouse(board, ann, med).ok).toBe(true);
  });

  it('counts a hotel as the fifth building', () => {
    med.hasHotel = true;
    baltic.houses = 4;
    expect(buildingLevel(med)).toBe(5);
    expect(groupBuildingCount(board, med)).toBe(9);
    expect(canSellHouse(board, ann, baltic).ok).toBe(false); // the hotel outranks it
  });
});

describe('BuildRules — the bank and the wallet', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;
  let med: PropertyTile;

  beforeEach(() => {
    board = new Board();
    bank  = new Bank();
    ann   = new Player('p1', 'Ann', 'car');
    med   = board.getTile(MEDITERRANEAN) as PropertyTile;
    [MEDITERRANEAN, BALTIC].forEach((id) => {
      (board.getTile(id) as PropertyTile).ownerId = ann.id;
      ann.ownedTileIds.add(id);
    });
  });

  it('refuses to build when the bank has no houses left', () => {
    bank.houses = 0;
    expect(canBuildHouse(board, bank, ann, med).reason).toMatch(/run out of houses/);
  });

  it('refuses to build when the player cannot pay', () => {
    ann.cash = 49; // a house here is $50
    expect(canBuildHouse(board, bank, ann, med).reason).toMatch(/\$50/);
  });

  // Bank.sellHotel silently leaves the lot bare when it cannot hand back four
  // houses, so the rules stop the sale rather than let the buildings vanish.
  it('refuses to break a hotel the bank cannot supply houses for', () => {
    med.hasHotel = true;
    bank.houses = 3;
    expect(canSellHotel(bank, ann, med).ok).toBe(false);
    bank.houses = 4;
    expect(canSellHotel(bank, ann, med).ok).toBe(true);
  });
});

describe('BuildRules — mortgaging', () => {
  let board: Board;
  let ann: Player;
  let med: PropertyTile;

  beforeEach(() => {
    board = new Board();
    ann   = new Player('p1', 'Ann', 'car');
    med   = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.ownerId = ann.id;
    ann.ownedTileIds.add(MEDITERRANEAN);
  });

  it('refuses to mortgage a lot whose colour group still has buildings', () => {
    const baltic = board.getTile(BALTIC) as PropertyTile;
    baltic.ownerId = ann.id;
    baltic.houses = 1;
    const check = canMortgage(board, ann, med);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/buildings/);
  });

  it('mortgages a bare lot', () => {
    expect(canMortgage(board, ann, med).ok).toBe(true);
  });

  it('will not mortgage the same lot twice', () => {
    med.isMortgaged = true;
    expect(canMortgage(board, ann, med).reason).toMatch(/already mortgaged/);
  });

  it('charges 110% to redeem, and refuses when that is out of reach', () => {
    med.isMortgaged = true;
    expect(unmortgageCost(med)).toBe(33); // floor(30 * 1.1)
    ann.cash = 32;
    expect(canUnmortgage(ann, med).ok).toBe(false);
    ann.cash = 33;
    expect(canUnmortgage(ann, med).ok).toBe(true);
  });

  it('applies to railroads as well as properties', () => {
    const rail = board.getTile(READING_RAILROAD);
    if (!isOwnable(rail)) throw new Error('a railroad should be ownable');
    rail.ownerId = ann.id;
    expect(canMortgage(board, ann, rail).ok).toBe(true);
    expect(isOwnable(board.getTile(0))).toBe(false); // GO changes hands never
  });
});

describe('BuildRules — every refusal explains itself', () => {
  it('never returns an empty reason with ok=false', () => {
    const board = new Board();
    const bank  = new Bank();
    const ann   = new Player('p1', 'Ann', 'car');
    const med   = board.getTile(MEDITERRANEAN) as PropertyTile;

    const checks = [
      canBuildHouse(board, bank, ann, med),
      canBuildHotel(board, bank, ann, med),
      canSellHouse(board, ann, med),
      canSellHotel(bank, ann, med),
      canMortgage(board, ann, med),
      canUnmortgage(ann, med),
    ];
    checks.forEach((check) => {
      expect(check.ok).toBe(false);
      expect(check.reason.length).toBeGreaterThan(0);
    });
  });
});
