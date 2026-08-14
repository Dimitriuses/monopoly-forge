import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { quoteRent, countOwnedOfType } from '@/game/Rent';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';

// Railroads sit at 5, 15, 25, 35; utilities at 12 and 28.
const RAILROADS = [5, 15, 25, 35];
const UTILITIES = [12, 28];
const MEDITERRANEAN = 1;
const BALTIC = 3;
const BOARDWALK = 39;

describe('quoteRent — properties', () => {
  let board: Board;
  let owner: Player;

  const give = (...ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id);
    if (isOwnable(tile)) tile.ownerId = owner.id;
    owner.ownedTileIds.add(id);
  });

  const quote = (tileId: number, declared?: number) =>
    quoteRent(board, board.getTile(tileId), owner, { diceTotal: 7, declared });

  beforeEach(() => {
    board = new Board();
    owner = new Player('p1', 'Ann', 'car');
  });

  it('charges the tier the tile worked out for itself', () => {
    give(BOARDWALK);
    const tile = board.getTile(BOARDWALK) as PropertyTile;
    tile.houses = 2;
    expect(quote(BOARDWALK, tile.currentRent).amount).toBe(600);
  });

  // The standard rule the game was missing: a complete colour group with nothing
  // built on it charges twice the bare-lot rent.
  it('doubles the bare-lot rent on a complete colour group', () => {
    give(MEDITERRANEAN, BALTIC);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    const single = quoteRent(board, med, owner, { diceTotal: 7, declared: med.currentRent });
    expect(single.amount).toBe(4);                       // rentTiers[0] is 2
    expect(single.notes).toContain('×2 — full colour group');
  });

  it('does not double once a house is standing', () => {
    give(MEDITERRANEAN, BALTIC);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.houses = 1;
    expect(quote(MEDITERRANEAN, med.currentRent).amount).toBe(10);
  });

  it('does not double a group the owner has not completed', () => {
    give(MEDITERRANEAN); // Baltic still unowned
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    expect(quote(MEDITERRANEAN, med.currentRent).amount).toBe(2);
  });

  it('does not double a group split between two players', () => {
    const rival = new Player('p2', 'Bo', 'dog');
    give(MEDITERRANEAN);
    (board.getTile(BALTIC) as PropertyTile).ownerId = rival.id;
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    expect(quote(MEDITERRANEAN, med.currentRent).amount).toBe(2);
  });

  it('charges nothing for a mortgaged lot, group or no group', () => {
    give(MEDITERRANEAN, BALTIC);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.isMortgaged = true;
    expect(quote(MEDITERRANEAN, med.currentRent).amount).toBe(0);
  });
});

describe('quoteRent — railroads', () => {
  let board: Board;
  let owner: Player;

  const own = (...ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id);
    if (isOwnable(tile)) tile.ownerId = owner.id;
    owner.ownedTileIds.add(id);
  });

  beforeEach(() => {
    board = new Board();
    owner = new Player('p1', 'Ann', 'car');
  });

  it('prices by how many railroads the owner holds', () => {
    const expected = [25, 50, 100, 200];
    RAILROADS.forEach((id, i) => {
      own(id);
      const quoted = quoteRent(board, board.getTile(RAILROADS[0]), owner, { diceTotal: 7 });
      expect(quoted.amount).toBe(expected[i]);
    });
  });

  it('doubles the rate when a card sent the player here', () => {
    own(RAILROADS[0], RAILROADS[1]);
    const quoted = quoteRent(board, board.getTile(RAILROADS[0]), owner,
      { diceTotal: 7, arrival: 'railroadDouble' });
    expect(quoted.amount).toBe(100); // two railroads = $50, doubled
    expect(quoted.notes).toContain('sent here by a card');
  });

  it('doubles nothing when the railroad is mortgaged', () => {
    own(RAILROADS[0]);
    const rail = board.getTile(RAILROADS[0]);
    if (isOwnable(rail)) rail.isMortgaged = true;
    const quoted = quoteRent(board, rail, owner, { diceTotal: 7, arrival: 'railroadDouble' });
    expect(quoted.amount).toBe(0);
    expect(quoted.notes).toEqual([]);
  });
});

describe('quoteRent — utilities', () => {
  let board: Board;
  let owner: Player;

  const own = (...ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id);
    if (isOwnable(tile)) tile.ownerId = owner.id;
    owner.ownedTileIds.add(id);
  });

  beforeEach(() => {
    board = new Board();
    owner = new Player('p1', 'Ann', 'car');
  });

  it('charges four times the dice for one utility, ten for both', () => {
    own(UTILITIES[0]);
    expect(quoteRent(board, board.getTile(UTILITIES[0]), owner, { diceTotal: 9 }).amount).toBe(36);
    own(UTILITIES[1]);
    expect(quoteRent(board, board.getTile(UTILITIES[0]), owner, { diceTotal: 9 }).amount).toBe(90);
  });

  // A card charges ten times the dice however many the owner holds.
  it('charges ten times the dice when a card sent the player here', () => {
    own(UTILITIES[0]);
    const quoted = quoteRent(board, board.getTile(UTILITIES[0]), owner,
      { diceTotal: 6, arrival: 'utilityTenTimes' });
    expect(quoted.amount).toBe(60);
    expect(quoted.notes).toContain('sent here by a card');
  });
});

describe('countOwnedOfType', () => {
  it('counts only the tiles of the asked-for type', () => {
    const board = new Board();
    const player = new Player('p1', 'Ann', 'car');
    [...RAILROADS.slice(0, 3), UTILITIES[0], MEDITERRANEAN].forEach((id) => player.ownedTileIds.add(id));

    expect(countOwnedOfType(board, player, 'railroad')).toBe(3);
    expect(countOwnedOfType(board, player, 'utility')).toBe(1);
    expect(countOwnedOfType(board, player, 'property')).toBe(1);
  });
});
