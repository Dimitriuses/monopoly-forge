import { describe, it, expect, beforeEach } from 'vitest';
import { Auction, MIN_BID_INCREMENT } from '@/game/Auction';
import { Player } from '@/game/Player';

const BOARDWALK = 39;

describe('Auction — round robin', () => {
  let ann: Player;
  let bo: Player;
  let cy: Player;
  let auction: Auction;

  beforeEach(() => {
    ann = new Player('p1', 'Ann', 'car');
    bo  = new Player('p2', 'Bo', 'dog');
    cy  = new Player('p3', 'Cy', 'iron');
    auction = new Auction(BOARDWALK, [ann, bo, cy]);
  });

  it('opens with no bid and the first seat to act', () => {
    expect(auction.highBid).toBe(0);
    expect(auction.highBidderId).toBeNull();
    expect(auction.currentBidder?.id).toBe('p1');
    expect(auction.minimumBid).toBe(MIN_BID_INCREMENT);
    expect(auction.result).toBeNull();
  });

  it('passes the turn along after each raise', () => {
    expect(auction.bid('p1', 10)).toBe(true);
    expect(auction.currentBidder?.id).toBe('p2');
    expect(auction.bid('p2', 20)).toBe(true);
    expect(auction.currentBidder?.id).toBe('p3');
    expect(auction.bid('p3', 30)).toBe(true);
    expect(auction.currentBidder?.id).toBe('p1');   // back round
    expect(auction.highBid).toBe(30);
  });

  it('refuses a bid from anyone but the player on turn', () => {
    expect(auction.bid('p2', 50)).toBe(false);
    expect(auction.highBid).toBe(0);
  });

  it('refuses a raise that does not clear the increment', () => {
    auction.bid('p1', 100);
    expect(auction.bid('p2', 100)).toBe(false);
    expect(auction.bid('p2', 105)).toBe(false);
    expect(auction.bid('p2', 110)).toBe(true);
  });

  it('refuses a bid the player cannot cover', () => {
    bo.cash = 40;
    auction.bid('p1', 30);
    expect(auction.bid('p2', 500)).toBe(false);
    expect(auction.canBid(bo)).toBe(true);      // $40 still covers $40
    bo.cash = 39;
    expect(auction.canBid(bo)).toBe(false);
  });

  // A pass is final: the point of the rule is that you cannot sit out a round
  // and come back once the price stops climbing.
  it('drops a bidder who passes, and never asks them again', () => {
    auction.pass('p1');
    expect(auction.currentBidder?.id).toBe('p2');
    expect(auction.bidders.map((p) => p.id)).toEqual(['p2', 'p3']);

    auction.bid('p2', 10);
    expect(auction.currentBidder?.id).toBe('p3');
    auction.bid('p3', 20);
    expect(auction.currentBidder?.id).toBe('p2');  // p1 is skipped for good
  });

  it('keeps the pointer on the right player when the last seat passes', () => {
    auction.bid('p1', 10);
    auction.bid('p2', 20);
    expect(auction.currentBidder?.id).toBe('p3');
    auction.pass('p3');
    expect(auction.currentBidder?.id).toBe('p1');
  });
});

describe('Auction — settlement', () => {
  let ann: Player;
  let bo: Player;
  let cy: Player;

  const auctionOf = () => new Auction(BOARDWALK, [ann, bo, cy]);

  beforeEach(() => {
    ann = new Player('p1', 'Ann', 'car');
    bo  = new Player('p2', 'Bo', 'dog');
    cy  = new Player('p3', 'Cy', 'iron');
  });

  it('awards the tile to the last bidder standing', () => {
    const auction = auctionOf();
    auction.bid('p1', 50);
    auction.bid('p2', 100);
    auction.pass('p3');
    auction.pass('p1');

    expect(auction.complete).toBe(true);
    expect(auction.result).toEqual({ tileId: BOARDWALK, winnerId: 'p2', amount: 100 });
  });

  it('does not make the leader outbid themselves', () => {
    const auction = auctionOf();
    auction.bid('p1', 50);
    auction.pass('p2');
    expect(auction.complete).toBe(false);
    auction.pass('p3');
    expect(auction.complete).toBe(true);
    expect(auction.result?.winnerId).toBe('p1');
  });

  it('sells nothing when every bidder passes', () => {
    const auction = auctionOf();
    auction.pass('p1');
    auction.pass('p2');
    expect(auction.complete).toBe(false);   // p3 may still bid
    auction.pass('p3');

    expect(auction.complete).toBe(true);
    expect(auction.result).toEqual({ tileId: BOARDWALK, winnerId: null, amount: 0 });
  });

  it('lets a single remaining bidder take it at the minimum', () => {
    const auction = new Auction(BOARDWALK, [ann]);
    expect(auction.currentBidder?.id).toBe('p1');
    auction.bid('p1', 10);
    expect(auction.result).toEqual({ tileId: BOARDWALK, winnerId: 'p1', amount: 10 });
  });

  it('ignores bids once the hammer has fallen', () => {
    const auction = auctionOf();
    auction.bid('p1', 50);
    auction.pass('p2');
    auction.pass('p3');
    expect(auction.bid('p1', 500)).toBe(false);
    expect(auction.result?.amount).toBe(50);
  });

  it('leaves out bankrupt players entirely', () => {
    bo.isBankrupt = true;
    const auction = auctionOf();
    expect(auction.bidders.map((p) => p.id)).toEqual(['p1', 'p3']);
  });

  it('completes immediately when nobody is solvent enough to be asked', () => {
    const auction = new Auction(BOARDWALK, []);
    expect(auction.complete).toBe(true);
    expect(auction.currentBidder).toBeNull();
    expect(auction.result?.winnerId).toBeNull();
  });
});
