import { describe, it, expect, beforeEach } from 'vitest';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import {
  shouldBuy, auctionCeiling, nextBid, jailChoice, buildPlan, redeemPlan,
  acceptTrade, proposeTrade,
  DEFAULT_PROFILE, type BotContext,
} from '@/game/Bot';
import { emptyOffer } from '@/game/Trade';
import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable, type Ownable, type Tile } from '@/tiles/Tile';
import { CHANCE_CARDS } from '@/cards/CardDeck';

const MEDITERRANEAN = 1;   // brown, $60
const BALTIC = 3;          // brown, $60
const ORIENTAL = 6;        // light blue, $100
const VERMONT = 8;         // light blue, $100
const CONNECTICUT = 9;     // light blue, $120
const READING = 5;         // railroad, $200
const PENNSYLVANIA_RR = 15;
const BOARDWALK = 39;      // $400

describe('Bot', () => {
  let board: Board;
  let bank: Bank;
  let bot: Player;
  let rival: Player;
  let ctx: BotContext;

  const ownable = (id: number): Tile & Ownable => {
    const tile = board.getTile(id);
    if (!isOwnable(tile)) throw new Error(`tile ${id} is not ownable`);
    return tile;
  };

  const give = (player: Player, ...ids: number[]) => ids.forEach((id) => {
    ownable(id).ownerId = player.id;
    player.ownedTileIds.add(id);
  });

  beforeEach(() => {
    board = new Board();
    bank  = new Bank();
    bot   = new Player('p1', 'Bot', 'car', true);
    rival = new Player('p2', 'Ann', 'dog');
    ctx   = { board, bank, player: bot, players: [bot, rival] };
  });

  // ── Buying ────────────────────────────────────────────────────────────────

  describe('buying at the asking price', () => {
    it('buys when the price leaves its reserve intact', () => {
      expect(shouldBuy(ctx, ownable(MEDITERRANEAN))).toBe(true);
    });

    it('declines when paying would eat into the reserve', () => {
      bot.cash = DEFAULT_PROFILE.reserve + 30;   // Mediterranean is $60
      expect(shouldBuy(ctx, ownable(MEDITERRANEAN))).toBe(false);
    });

    it('spends into the reserve for a deed that completes a group', () => {
      give(bot, MEDITERRANEAN);                  // brown is a group of two
      bot.cash = 70;
      expect(shouldBuy(ctx, ownable(BALTIC))).toBe(true);
    });

    it('never buys what it cannot afford', () => {
      bot.cash = 10;
      expect(shouldBuy(ctx, ownable(BOARDWALK))).toBe(false);
    });

    it('counts a second railroad as worth stretching for', () => {
      give(bot, READING);
      bot.cash = 210;
      expect(shouldBuy(ctx, ownable(PENNSYLVANIA_RR))).toBe(true);
    });
  });

  // ── Auctions ──────────────────────────────────────────────────────────────

  describe('bidding', () => {
    it('will pay over the odds for a deed that completes a group', () => {
      give(bot, MEDITERRANEAN);
      const ceiling = auctionCeiling(ctx, ownable(BALTIC));
      expect(ceiling).toBeGreaterThan(60);
    });

    it('caps an ordinary deed near its face value', () => {
      const ceiling = auctionCeiling(ctx, ownable(ORIENTAL));
      expect(ceiling).toBeLessThanOrEqual(Math.floor(100 * DEFAULT_PROFILE.auctionCeiling));
    });

    // A raise of the table minimum would take thirty rounds to settle a $300
    // deed; the step is a tenth of face value so an auction actually converges.
    it('raises in steps rather than crawling up by the minimum', () => {
      const bid = nextBid(ctx, ownable(ORIENTAL), 40, 50);   // Oriental is $100
      expect(bid).toBe(50);                                   // max(50, 40 + 10)
      expect(nextBid(ctx, ownable(BOARDWALK), 40, 50)).toBe(80); // $400 → +40
    });

    it('never raises above its own ceiling', () => {
      const tile = ownable(ORIENTAL);
      const ceiling = auctionCeiling(ctx, tile);
      expect(nextBid(ctx, tile, ceiling - 5, ceiling - 5 + 10)).toBeNull();
      expect(nextBid(ctx, tile, ceiling - 40, ceiling - 30)).toBeLessThanOrEqual(ceiling);
    });

    it('passes once the minimum clears its ceiling', () => {
      expect(nextBid(ctx, ownable(ORIENTAL), 500, 510)).toBeNull();
    });

    it('passes rather than bid its reserve away on a deed it does not need', () => {
      bot.cash = DEFAULT_PROFILE.reserve + 10;
      expect(nextBid(ctx, ownable(ORIENTAL), 0, 20)).toBeNull();
    });
  });

  // ── Jail ──────────────────────────────────────────────────────────────────

  describe('getting out of jail', () => {
    it('spends a card before anything else', () => {
      bot.jailCards.push(CHANCE_CARDS.find((c) => c.isGetOutOfJail)!);
      expect(jailChoice(ctx, 50)).toBe('card');
    });

    it('sits it out while the board is bare — jail is cheap rent protection', () => {
      expect(jailChoice(ctx, 50)).toBe('roll');
    });

    it('pays to get out once houses are up and it can spare the cash', () => {
      (board.getTile(ORIENTAL) as PropertyTile).houses = 2;
      expect(jailChoice(ctx, 50)).toBe('pay');
    });

    it('will not pay itself below the reserve', () => {
      (board.getTile(ORIENTAL) as PropertyTile).houses = 2;
      bot.cash = 60;
      expect(jailChoice(ctx, 50)).toBe('roll');
    });
  });

  // ── Development ───────────────────────────────────────────────────────────

  describe('building', () => {
    it('builds nothing without a complete colour group', () => {
      give(bot, MEDITERRANEAN);
      expect(buildPlan(ctx)).toEqual([]);
    });

    it('plans houses on a complete group, cheapest lot first', () => {
      give(bot, MEDITERRANEAN, BALTIC);
      bot.cash = 1000;

      const plan = buildPlan(ctx);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan.every((step) => step.kind === 'house')).toBe(true);
      expect(plan.map((s) => s.tileId)).toContain(MEDITERRANEAN);
    });

    it('keeps the reserve and the buffer out of the budget', () => {
      give(bot, MEDITERRANEAN, BALTIC);
      bot.cash = DEFAULT_PROFILE.reserve + DEFAULT_PROFILE.buildBuffer + 10;  // a house is $50
      expect(buildPlan(ctx)).toEqual([]);
    });

    it('does not plan past what the bank can supply', () => {
      give(bot, MEDITERRANEAN, BALTIC);
      bot.cash = 5000;
      bank.houses = 0;
      expect(buildPlan(ctx)).toEqual([]);
    });

    it('redeems the most valuable mortgage first, when it can spare the cash', () => {
      give(bot, MEDITERRANEAN, BOARDWALK);
      ownable(MEDITERRANEAN).isMortgaged = true;
      ownable(BOARDWALK).isMortgaged = true;
      bot.cash = 2000;

      expect(redeemPlan(ctx)).toEqual([BOARDWALK, MEDITERRANEAN]);
    });

    it('redeems nothing while short of cash', () => {
      give(bot, BOARDWALK);
      ownable(BOARDWALK).isMortgaged = true;
      bot.cash = 220;   // redeeming costs $220, leaving nothing
      expect(redeemPlan(ctx)).toEqual([]);
    });
  });

  // ── Trading ───────────────────────────────────────────────────────────────

  describe('answering an offer', () => {
    const offerTo = (over: Partial<ReturnType<typeof emptyOffer>>) =>
      ({ ...emptyOffer('p2', 'p1'), ...over });   // rival proposes to the bot

    it('accepts cash that beats what it gives up', () => {
      give(bot, ORIENTAL);
      expect(acceptTrade(ctx, offerTo({ fromCash: 400, toTileIds: [ORIENTAL] }))).toBe(true);
    });

    it('declines an offer worth less than what it hands over', () => {
      give(bot, ORIENTAL);
      expect(acceptTrade(ctx, offerTo({ fromCash: 20, toTileIds: [ORIENTAL] }))).toBe(false);
    });

    // The one thing it will not do at any price.
    it('refuses to hand over the deed that completes the other side’s group', () => {
      give(rival, MEDITERRANEAN);
      give(bot, BALTIC);
      expect(acceptTrade(ctx, offerTo({ fromCash: 5000, toTileIds: [BALTIC] }))).toBe(false);
    });

    it('will not agree to cash it does not have', () => {
      give(rival, ORIENTAL);
      bot.cash = 50;
      expect(acceptTrade(ctx, offerTo({ fromTileIds: [ORIENTAL], toCash: 500 }))).toBe(false);
    });

    it('values a deed that completes its own group above the sticker price', () => {
      give(bot, MEDITERRANEAN);
      give(rival, BALTIC);
      // $60 deed, offered for $80 cash: a straight loss on price, a gain on value.
      expect(acceptTrade(ctx, offerTo({ fromTileIds: [BALTIC], toCash: 80 }))).toBe(true);
    });

    // ...but it *will* part with one for the key to a group of its own. Without
    // that exception the only deed worth asking for is the only deed nobody
    // would ever hand over, and two bots sit across the table for a whole game.
    it('will hand over a key in exchange for the key to its own group', () => {
      give(bot, BALTIC, ORIENTAL, VERMONT);     // one lot short of light blue
      give(rival, MEDITERRANEAN, CONNECTICUT);  // one lot short of brown
      expect(acceptTrade(ctx, offerTo({
        fromTileIds: [CONNECTICUT], toTileIds: [BALTIC], fromCash: 200,
      }))).toBe(true);
    });
  });

  // ── Making an offer ───────────────────────────────────────────────────────

  describe('proposing a trade', () => {
    it('offers nothing when there is nothing worth swapping', () => {
      give(bot, ORIENTAL);
      give(rival, BOARDWALK);
      expect(proposeTrade(ctx)).toBeNull();
    });

    it('offers its key for the one it needs, and tops it up with cash', () => {
      give(bot, BALTIC, ORIENTAL, VERMONT);
      give(rival, MEDITERRANEAN, CONNECTICUT);
      bot.cash = 2000;

      const offer = proposeTrade(ctx)!;
      expect(offer).not.toBeNull();
      expect(offer.fromId).toBe('p1');
      expect(offer.toId).toBe('p2');
      expect(offer.toTileIds).toEqual([CONNECTICUT]);
      expect(offer.fromTileIds).toEqual([BALTIC]);
      // And the other side would actually take it — which is the whole point.
      expect(acceptTrade({ ...ctx, player: rival }, offer)).toBe(true);
    });

    it('offers the least cash that gets a yes, not the most it has', () => {
      give(bot, BALTIC, ORIENTAL, VERMONT);
      give(rival, MEDITERRANEAN, CONNECTICUT);
      bot.cash = 2000;

      const offer = proposeTrade(ctx)!;
      const rivalCtx = { ...ctx, player: rival };
      expect(acceptTrade(rivalCtx, offer)).toBe(true);
      // A single step less is refused, so this really is the threshold.
      expect(acceptTrade(rivalCtx, { ...offer, fromCash: offer.fromCash - 10 })).toBe(false);
    });

    it('will not spend into its reserve to do it', () => {
      give(bot, BALTIC, ORIENTAL, VERMONT);
      give(rival, MEDITERRANEAN, CONNECTICUT);
      bot.cash = DEFAULT_PROFILE.reserve;
      expect(proposeTrade(ctx)).toBeNull();
    });

    it('buys a second railroad for cash — nobody is handing over a key', () => {
      give(bot, READING);
      give(rival, PENNSYLVANIA_RR);
      bot.cash = 2000;

      const offer = proposeTrade(ctx)!;
      expect(offer.toTileIds).toEqual([PENNSYLVANIA_RR]);
      expect(offer.fromTileIds).toEqual([]);
      expect(offer.fromCash).toBeGreaterThan(0);
    });

    it('decides the same way twice', () => {
      give(bot, BALTIC, ORIENTAL, VERMONT);
      give(rival, MEDITERRANEAN, CONNECTICUT);
      bot.cash = 900;
      expect(proposeTrade(ctx)).toEqual(proposeTrade(ctx));
    });
  });

  // ── The contract the simulator depends on ─────────────────────────────────

  it('decides the same way twice, so a seeded game replays', () => {
    give(bot, MEDITERRANEAN, BALTIC);
    bot.cash = 800;

    const first = JSON.stringify([
      shouldBuy(ctx, ownable(ORIENTAL)),
      auctionCeiling(ctx, ownable(ORIENTAL)),
      jailChoice(ctx, 50),
      buildPlan(ctx),
    ]);
    const second = JSON.stringify([
      shouldBuy(ctx, ownable(ORIENTAL)),
      auctionCeiling(ctx, ownable(ORIENTAL)),
      jailChoice(ctx, 50),
      buildPlan(ctx),
    ]);
    expect(second).toBe(first);
  });
});
