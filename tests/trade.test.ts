import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import {
  emptyOffer, reverseOffer, isEmptyOffer,
  validateTrade, executeTrade, describeOffer,
} from '@/game/Trade';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable } from '@/tiles/Tile';
import { CHANCE_CARDS } from '@/cards/CardDeck';

const MEDITERRANEAN = 1;
const BALTIC = 3;
const READING = 5;
const BOARDWALK = 39;

describe('Trade', () => {
  let board: Board;
  let players: Player[];
  let ann: Player;
  let bo: Player;

  const give = (player: Player, ...ids: number[]) => ids.forEach((id) => {
    const tile = board.getTile(id);
    if (isOwnable(tile)) tile.ownerId = player.id;
    player.ownedTileIds.add(id);
  });

  const offerOf = (over: Partial<ReturnType<typeof emptyOffer>> = {}) =>
    ({ ...emptyOffer('p1', 'p2'), ...over });

  beforeEach(() => {
    board = new Board();
    ann = new Player('p1', 'Ann', 'car');
    bo  = new Player('p2', 'Bo', 'dog');
    players = [ann, bo];
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it('refuses an offer with nothing in it', () => {
    const check = validateTrade(board, players, emptyOffer('p1', 'p2'));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/nothing in this offer/);
  });

  it('refuses to trade a deed the offerer does not own', () => {
    give(bo, BOARDWALK);
    const check = validateTrade(board, players, offerOf({ fromTileIds: [BOARDWALK] }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/Ann does not own Boardwalk/);
  });

  it('refuses cash the offerer does not have', () => {
    ann.cash = 100;
    const check = validateTrade(board, players, offerOf({ fromCash: 500 }));
    expect(check.reason).toMatch(/does not have \$500/);
  });

  it('refuses jail cards the offerer does not hold', () => {
    const check = validateTrade(board, players, offerOf({ fromJailCards: 1 }));
    expect(check.reason).toMatch(/jail cards/);
  });

  // Buildings would end up standing on a group their owner no longer holds.
  it('refuses a lot whose colour group still has buildings on it', () => {
    give(ann, MEDITERRANEAN, BALTIC);
    (board.getTile(BALTIC) as PropertyTile).level = 1;

    const check = validateTrade(board, players, offerOf({ fromTileIds: [MEDITERRANEAN] }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/Sell the buildings/);
  });

  it('allows a bare lot from a group with nothing built', () => {
    give(ann, MEDITERRANEAN);
    expect(validateTrade(board, players, offerOf({ fromTileIds: [MEDITERRANEAN] })).ok).toBe(true);
  });

  it('refuses a trade with a bankrupt player', () => {
    bo.isBankrupt = true;
    give(ann, MEDITERRANEAN);
    expect(validateTrade(board, players, offerOf({ fromTileIds: [MEDITERRANEAN] })).ok).toBe(false);
  });

  // ── Execution ───────────────────────────────────────────────────────────────

  it('swaps deeds, updating both the tile and both players', () => {
    give(ann, MEDITERRANEAN);
    give(bo, BOARDWALK);

    expect(executeTrade(board, players, offerOf({
      fromTileIds: [MEDITERRANEAN], toTileIds: [BOARDWALK],
    }))).toBe(true);

    expect((board.getTile(MEDITERRANEAN) as PropertyTile).ownerId).toBe('p2');
    expect((board.getTile(BOARDWALK) as PropertyTile).ownerId).toBe('p1');
    expect(ann.ownedTileIds.has(BOARDWALK)).toBe(true);
    expect(ann.ownedTileIds.has(MEDITERRANEAN)).toBe(false);
    expect(bo.ownedTileIds.has(MEDITERRANEAN)).toBe(true);
    expect(bo.ownedTileIds.has(BOARDWALK)).toBe(false);
  });

  it('nets the cash so neither side has to front the gross', () => {
    ann.cash = 100;
    bo.cash = 100;
    give(ann, MEDITERRANEAN);

    executeTrade(board, players, offerOf({
      fromTileIds: [MEDITERRANEAN], fromCash: 100, toCash: 80,
    }));

    expect(ann.cash).toBe(80);
    expect(bo.cash).toBe(120);
  });

  it('conserves cash across the table', () => {
    give(ann, READING);
    const before = ann.cash + bo.cash;
    executeTrade(board, players, offerOf({ fromTileIds: [READING], toCash: 350 }));
    expect(ann.cash + bo.cash).toBe(before);
  });

  it('moves jail cards', () => {
    const gooj = CHANCE_CARDS.find((c) => c.isGetOutOfJail)!;
    ann.jailCards.push(gooj);

    executeTrade(board, players, offerOf({ fromJailCards: 1, toCash: 50 }));

    expect(ann.jailCards).toEqual([]);
    expect(bo.jailCards).toEqual([gooj]);
    expect(ann.cash).toBe(1550);
  });

  it('changes nothing at all when the offer is illegal', () => {
    give(bo, BOARDWALK);
    const cash = [ann.cash, bo.cash];

    expect(executeTrade(board, players, offerOf({ fromTileIds: [BOARDWALK] }))).toBe(false);
    expect((board.getTile(BOARDWALK) as PropertyTile).ownerId).toBe('p2');
    expect([ann.cash, bo.cash]).toEqual(cash);
  });

  it('allows a one-sided gift', () => {
    give(ann, MEDITERRANEAN);
    expect(executeTrade(board, players, offerOf({ fromTileIds: [MEDITERRANEAN] }))).toBe(true);
    expect(bo.ownedTileIds.has(MEDITERRANEAN)).toBe(true);
  });

  // ── Shaping ─────────────────────────────────────────────────────────────────

  it('reverses an offer, which is all a counter is', () => {
    const original = offerOf({ fromTileIds: [MEDITERRANEAN], toCash: 200, fromJailCards: 1 });
    const counter = reverseOffer(original);

    expect(counter.fromId).toBe('p2');
    expect(counter.toId).toBe('p1');
    expect(counter.toTileIds).toEqual([MEDITERRANEAN]);
    expect(counter.fromCash).toBe(200);
    expect(counter.toJailCards).toBe(1);
    expect(isEmptyOffer(counter)).toBe(false);
  });

  it('describes an offer in plain language', () => {
    give(ann, MEDITERRANEAN);
    const text = describeOffer(board, players, offerOf({
      fromTileIds: [MEDITERRANEAN], toCash: 200,
    }));
    expect(text).toBe('Ann gives Mediterranean Ave for $200 from Bo');
  });

  it('says "nothing" for an empty side', () => {
    const text = describeOffer(board, players, offerOf({ fromCash: 50 }));
    expect(text).toMatch(/gives \$50 for nothing/);
  });
});
