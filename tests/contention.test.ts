import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { PropertyTile } from '@/tiles/PropertyTile';
import { Auction, tileSubject, MIN_BID_INCREMENT } from '@/game/Auction';
import {
  houseClaims, housesContested, houseReserve, nominateLot,
} from '@/game/Contention';
import { nextHouseBid, houseCeiling } from '@/game/Bot';

const BROWN      = [1, 3];      // Mediterranean, Baltic
const LIGHT_BLUE = [6, 8, 9];   // Oriental, Vermont, Connecticut

describe('Contention for the bank\'s last houses', () => {
  let board: Board;
  let bank: Bank;
  let ann: Player;
  let bo: Player;
  let cy: Player;
  let players: Player[];

  const give = (player: Player, ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id) as PropertyTile;
    tile.ownerId = player.id;
    player.ownedTileIds.add(id);
  });

  beforeEach(() => {
    board   = new Board();
    bank    = new Bank();
    ann     = new Player('p1', 'Ann', 'car');
    bo      = new Player('p2', 'Bo', 'dog');
    cy      = new Player('p3', 'Cy', 'iron');
    players = [ann, bo, cy];

    give(ann, BROWN);
    give(bo, LIGHT_BLUE);
  });

  // ─── Who is bidding ─────────────────────────────────────────────────────────

  it('counts a player who owns a group and can pay for a house', () => {
    const claims = houseClaims(board, bank, players);
    expect(claims.map((c) => c.player.id)).toEqual(['p1', 'p2']);
    expect(claims[0].lots.map((l) => l.id)).toEqual(BROWN);
  });

  it('does not count one who cannot afford it', () => {
    ann.cash = 10;
    expect(houseClaims(board, bank, players).map((c) => c.player.id)).toEqual(['p2']);
  });

  it('does not count one who owns no complete group', () => {
    expect(houseClaims(board, bank, players).some((c) => c.player.id === 'p3')).toBe(false);
  });

  it('does not count a bankrupt one', () => {
    ann.isBankrupt = true;
    expect(houseClaims(board, bank, players).map((c) => c.player.id)).toEqual(['p2']);
  });

  // ─── When the rule bites ────────────────────────────────────────────────────

  it('is not contested while the bank is stocked', () => {
    expect(bank.houses).toBe(32);
    expect(housesContested(board, bank, players)).toBe(false);
  });

  it('is contested when the bank holds fewer houses than there are claimants', () => {
    bank.houses = 1;
    expect(housesContested(board, bank, players)).toBe(true);
  });

  it('is not contested when only one player wants one', () => {
    bank.houses = 1;
    bo.cash = 0;
    expect(housesContested(board, bank, players)).toBe(false);
  });

  // With no houses left `canBuildHouse` refuses outright, so nobody is claiming
  // anything and there is nothing to auction — the shortage is total, not tight.
  it('is not contested once the bank is empty', () => {
    bank.houses = 0;
    expect(housesContested(board, bank, players)).toBe(false);
  });

  // ─── The price, and where the house goes ────────────────────────────────────

  it('opens at what the house is worth to the cheapest claimant', () => {
    bank.houses = 1;
    const claims = houseClaims(board, bank, players);
    const brownCost = (board.getTile(BROWN[0]) as PropertyTile).houseCost;
    expect(houseReserve(claims)).toBe(brownCost);
  });

  it('will not sell a scarce house below the reserve', () => {
    bank.houses = 1;
    const claims  = houseClaims(board, bank, players);
    const reserve = houseReserve(claims);
    const auction = new Auction(
      { kind: 'house', id: BROWN[0], label: 'A house from the bank' },
      claims.map((c) => c.player), MIN_BID_INCREMENT, reserve,
    );

    expect(auction.minimumBid).toBe(reserve);
    expect(auction.bid('p1', reserve - 10)).toBe(false);
    expect(auction.bid('p1', reserve)).toBe(true);
    expect(auction.minimumBid).toBe(reserve + MIN_BID_INCREMENT);
  });

  it('gives the winner the lot they asked for, if they asked', () => {
    bank.houses = 1;
    const claims = houseClaims(board, bank, players);
    const baltic = board.getTile(BROWN[1]) as PropertyTile;
    expect(nominateLot(claims, ann, baltic)?.id).toBe(BROWN[1]);
  });

  it('gives anybody else the cheapest lot they could build on', () => {
    bank.houses = 1;
    const claims = houseClaims(board, bank, players);
    // Bo did not ask for anything — the request was Ann's, and it is not his lot.
    expect(nominateLot(claims, bo, board.getTile(BROWN[1]) as PropertyTile)?.id)
      .toBe(LIGHT_BLUE[0]);
    expect(nominateLot(claims, cy, null)).toBeNull();   // Cy was never bidding
  });

  it('sells the house at the bid rather than the printed price', () => {
    const lot = board.getTile(BROWN[0]) as PropertyTile;
    const before = ann.cash;
    expect(bank.buyHouse(ann, lot, 175)).toBe(true);
    expect(ann.cash).toBe(before - 175);       // not lot.houseCost
    expect(lot.houses).toBe(1);
    expect(bank.houses).toBe(31);
  });

  // ─── What a bot pays ────────────────────────────────────────────────────────

  it('lets a bot pay over the odds for scarcity, but not out of its reserve', () => {
    const ctx = { board, bank, player: ann, players };
    expect(houseCeiling(ctx, 100)).toBe(150);          // 1.5× the printed cost
    ann.cash = 200;
    expect(houseCeiling(ctx, 100)).toBe(50);           // cash less the $150 reserve
    ann.cash = 100;
    expect(nextHouseBid(ctx, 100, 0, 50)).toBeNull();  // nothing left to bid with
  });

  it('raises by a tenth of the house cost, never past the ceiling', () => {
    const ctx = { board, bank, player: ann, players };
    ann.cash = 1000;
    expect(nextHouseBid(ctx, 100, 0, 50)).toBe(50);    // the reserve, first time
    expect(nextHouseBid(ctx, 100, 60, 70)).toBe(70);
    expect(nextHouseBid(ctx, 100, 145, 155)).toBeNull();  // past 1.5× = 150
  });
});
