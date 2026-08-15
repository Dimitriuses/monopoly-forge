import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { liquidValue, raiseCash, settleDebt, transferEstate } from '@/game/Estate';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';
import { CHANCE_CARDS } from '@/cards/CardDeck';

const MEDITERRANEAN = 1;   // brown, $60, mortgage $30, houses $50
const BALTIC = 3;          // brown, $60, mortgage $30, houses $50
const BOARDWALK = 39;      // dark blue, mortgage $200
const READING = 5;         // railroad, mortgage $100

describe('Estate — what a player is worth', () => {
  let board: Board;
  let ann: Player;

  const give = (...ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id);
    if (isOwnable(tile)) tile.ownerId = ann.id;
    ann.ownedTileIds.add(id);
  });

  beforeEach(() => {
    board = new Board();
    ann = new Player('p1', 'Ann', 'car');
  });

  it('counts cash, mortgage values and half the cost of every building', () => {
    give(MEDITERRANEAN, BALTIC);
    (board.getTile(MEDITERRANEAN) as PropertyTile).level = 2;

    // 1500 cash + 2 × $25 + 2 × $30 mortgage
    expect(liquidValue(board, ann)).toBe(1500 + 50 + 60);
  });

  it('does not count a deed that is already mortgaged', () => {
    give(BOARDWALK);
    expect(liquidValue(board, ann)).toBe(1500 + 200);
    (board.getTile(BOARDWALK) as PropertyTile).isMortgaged = true;
    expect(liquidValue(board, ann)).toBe(1500);
  });
});

describe('Estate — the fire sale', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;

  const give = (...ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id);
    if (isOwnable(tile)) tile.ownerId = ann.id;
    ann.ownedTileIds.add(id);
  });

  beforeEach(() => {
    board = new Board();
    bank = new Bank();
    ann = new Player('p1', 'Ann', 'car');
    ann.cash = 0;
  });

  it('sells buildings before it mortgages anything', () => {
    give(MEDITERRANEAN, BALTIC);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.level = 1;
    const stock = bank.houses;

    raiseCash(board, bank, ann, 25);

    expect(ann.cash).toBe(25);                 // half of the $50 house
    expect(med.level).toBe(0);
    expect(med.isMortgaged).toBe(false);       // deed untouched
    expect(bank.houses).toBe(stock + 1);       // house went back to stock
  });

  it('takes buildings down from the tallest lot, keeping the group even', () => {
    give(MEDITERRANEAN, BALTIC);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    const baltic = board.getTile(BALTIC) as PropertyTile;
    med.level = 3;
    baltic.level = 2;

    raiseCash(board, bank, ann, 25);
    expect(med.level).toBe(2);
    expect(baltic.level).toBe(2);
  });

  it('mortgages the largest deeds first, and stops as soon as it has enough', () => {
    give(MEDITERRANEAN, BOARDWALK, READING);

    raiseCash(board, bank, ann, 150);

    expect(ann.cash).toBe(200);                                  // Boardwalk alone covers it
    expect((board.getTile(BOARDWALK) as PropertyTile).isMortgaged).toBe(true);
    expect((board.getTile(READING) as PropertyTile).isMortgaged).toBe(false);
    expect((board.getTile(MEDITERRANEAN) as PropertyTile).isMortgaged).toBe(false);
  });

  it('raises everything it can when the target is out of reach', () => {
    give(MEDITERRANEAN, BALTIC);
    (board.getTile(MEDITERRANEAN) as PropertyTile).level = 1;

    raiseCash(board, bank, ann, 99_999);

    expect(ann.cash).toBe(25 + 30 + 30);
    expect((board.getTile(MEDITERRANEAN) as PropertyTile).isMortgaged).toBe(true);
    expect((board.getTile(BALTIC) as PropertyTile).isMortgaged).toBe(true);
  });
});

describe('Estate — settling a debt', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;
  let bo: Player;

  const give = (player: Player, ...ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id);
    if (isOwnable(tile)) tile.ownerId = player.id;
    player.ownedTileIds.add(id);
  });

  beforeEach(() => {
    board = new Board();
    bank = new Bank();
    ann = new Player('p1', 'Ann', 'car');
    bo = new Player('p2', 'Bo', 'dog');
  });

  it('pays straight from cash when there is enough', () => {
    const settlement = settleDebt(board, bank, ann, bo, 300);

    expect(settlement).toMatchObject({ paid: 300, shortfall: 0, bankrupt: false });
    expect(settlement.actions).toEqual([]);
    expect(ann.cash).toBe(1200);
    expect(bo.cash).toBe(1800);
  });

  it('mortgages to cover the gap rather than declaring bankruptcy', () => {
    ann.cash = 50;
    give(ann, BOARDWALK);   // $200 of mortgage value

    const settlement = settleDebt(board, bank, ann, bo, 200);

    expect(settlement.bankrupt).toBe(false);
    expect(settlement.paid).toBe(200);
    expect(ann.cash).toBe(50);   // 50 + 200 raised - 200 paid
    expect((board.getTile(BOARDWALK) as PropertyTile).isMortgaged).toBe(true);
    expect(settlement.actions.join()).toMatch(/mortgaged Boardwalk/);
    expect(bo.cash).toBe(1700);
  });

  // The old behaviour: cash clamped at zero, player flagged bankrupt, deeds left
  // in their name still charging rent.
  it('hands the whole estate to the creditor when the debt cannot be met', () => {
    ann.cash = 10;
    give(ann, MEDITERRANEAN, BALTIC);

    const settlement = settleDebt(board, bank, ann, bo, 5_000);

    expect(settlement.bankrupt).toBe(true);
    expect(settlement.paid).toBe(70);          // $10 cash + two $30 mortgages
    expect(settlement.shortfall).toBe(4_930);
    expect(ann.cash).toBe(0);
    expect(ann.isBankrupt).toBe(true);
    expect(ann.ownedTileIds.size).toBe(0);

    // 1500 + 70 raised, less 10% interest on the two mortgaged deeds ($3 each)
    // that came over with the estate. Inheriting a mortgage is not free — see
    // `chargeMortgageInterest`.
    expect(bo.cash).toBe(1564);
    expect(settlement.actions.join()).toMatch(/paid \$6 mortgage interest/);
    expect(bo.ownedTileIds.has(MEDITERRANEAN)).toBe(true);
    expect(bo.ownedTileIds.has(BALTIC)).toBe(true);
    expect((board.getTile(MEDITERRANEAN) as PropertyTile).ownerId).toBe('p2');
  });

  it('keeps the mortgage attached to a deed that changes hands', () => {
    ann.cash = 0;
    give(ann, BOARDWALK);
    (board.getTile(BOARDWALK) as PropertyTile).isMortgaged = true;

    settleDebt(board, bank, ann, bo, 500);

    const boardwalk = board.getTile(BOARDWALK) as PropertyTile;
    expect(boardwalk.ownerId).toBe('p2');
    expect(boardwalk.isMortgaged).toBe(true);
  });

  it('returns the deeds to the bank when the debt was owed to the bank', () => {
    ann.cash = 0;
    give(ann, MEDITERRANEAN);

    const settlement = settleDebt(board, bank, ann, null, 900);

    expect(settlement.bankrupt).toBe(true);
    expect((board.getTile(MEDITERRANEAN) as PropertyTile).ownerId).toBeNull();
    expect(ann.ownedTileIds.size).toBe(0);
  });

  it('passes any Get Out of Jail Free cards to the creditor', () => {
    const gooj = CHANCE_CARDS.find((c) => c.isGetOutOfJail)!;
    ann.cash = 0;
    ann.jailCards.push(gooj);

    settleDebt(board, bank, ann, bo, 100);

    expect(ann.jailCards).toEqual([]);
    expect(bo.jailCards).toEqual([gooj]);
  });

  // The toast has room for "sold 2 buildings, mortgaged 1 deed", not for the
  // itemised trail, so the counts travel with the settlement.
  it('counts what the fire sale sold and mortgaged', () => {
    ann.cash = 0;
    give(ann, MEDITERRANEAN, BALTIC);
    (board.getTile(MEDITERRANEAN) as PropertyTile).level = 2;

    const settlement = settleDebt(board, bank, ann, bo, 80);

    expect(settlement.bankrupt).toBe(false);
    expect(settlement.sold).toBe(2);        // both houses, at $25 each
    expect(settlement.mortgaged).toBe(1);   // one $30 deed closes the gap
    expect(settlement.actions).toHaveLength(3);
  });

  it('conserves cash across the table when a player goes under', () => {
    ann.cash = 120;
    const before = ann.cash + bo.cash;

    settleDebt(board, bank, ann, bo, 400);

    expect(ann.cash + bo.cash).toBe(before);
  });

  it('takes the buildings down with the estate', () => {
    ann.cash = 0;
    give(ann, MEDITERRANEAN, BALTIC);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.level = 2;
    const stock = bank.houses;

    settleDebt(board, bank, ann, bo, 10_000);

    expect(med.level).toBe(0);
    expect(med.level === 5).toBe(false);
    expect(bank.houses).toBe(stock + 2);   // both houses back in stock
  });

  // A hotel the bank cannot break into four houses survives the fire sale, and
  // must not simply evaporate when the deed changes hands.
  it('returns a surviving hotel to the bank rather than losing it', () => {
    ann.cash = 0;
    give(ann, MEDITERRANEAN);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.level = 5;
    bank.level = 0;                     // nothing to break the hotel into
    const hotels = bank.hotels;

    settleDebt(board, bank, ann, bo, 10_000);

    expect(med.level === 5).toBe(false);
    expect(bank.hotels).toBe(hotels + 1);
    expect(med.ownerId).toBe('p2');
  });
});

describe('Estate — transferring without a debt', () => {
  it('moves every deed and leaves the old owner holding nothing', () => {
    const board = new Board();
    const ann = new Player('p1', 'Ann', 'car');
    const bo = new Player('p2', 'Bo', 'dog');
    [MEDITERRANEAN, READING].forEach((id) => {
      const tile = board.getTile(id);
      if (isOwnable(tile)) tile.ownerId = ann.id;
      ann.ownedTileIds.add(id);
    });

    const { actions, returned } = transferEstate(board, new Bank(), ann, bo);

    expect(ann.ownedTileIds.size).toBe(0);
    expect(bo.ownedTileIds.size).toBe(2);
    expect(actions.join()).toMatch(/2 deed\(s\) passed to Bo/);
    // Nothing for the bank to sell — the deeds have an owner.
    expect(returned).toEqual([]);
  });

  it('reports what went back to the bank when there is no creditor', () => {
    const board = new Board();
    const ann = new Player('p1', 'Ann', 'car');
    const ids = [MEDITERRANEAN, READING];
    ids.forEach((id) => {
      const tile = board.getTile(id);
      if (isOwnable(tile)) tile.ownerId = ann.id;
      ann.ownedTileIds.add(id);
    });

    const { returned } = transferEstate(board, new Bank(), ann, null);

    expect([...returned].sort((a, b) => a - b)).toEqual([...ids].sort((a, b) => a - b));
    expect(ids.every((id) => {
      const tile = board.getTile(id);
      return isOwnable(tile) && tile.ownerId === null;
    })).toBe(true);
  });
});
