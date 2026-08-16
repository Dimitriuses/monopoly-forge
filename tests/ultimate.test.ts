import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { simulate } from '@/sim/Runner';
import { Board } from '@/game/Board';
import { Player } from '@/game/Player';
import { quoteRent } from '@/game/Rent';
import { knownTileEffects } from '@/game/TileEffects';
import { validateGame } from '@/games/Game';
import { gameById, rulesFor, ULTIMATE_GAME } from '@/games';
import { unloadGame } from '@/games/scope';
import { PropertyTile } from '@/tiles/PropertyTile';
import { RailroadTile, UtilityTile } from '@/tiles/SpecialTiles';
import { isOwnable } from '@/tiles/Tile';
import { EFFECT_TILE_TYPES, LADDERS } from '@/games/ultimate/tiles';
import { bus } from '@/utils/EventBus';
import { Bank } from '@/game/Bank';
import { walkTo } from '@/game/Landing';
import { canBuild, isProperty, ownsMajority, ownsWholeGroup } from '@/game/BuildRules';
import { giveHolding } from '@/game/Holdings';
import { rungAt, topLevel } from '@/game/BuildLadder';
import { Dice } from '@/game/Dice';
import { preferredOption, type ChoiceRequest } from '@/game/Choice';
import { applyTileEffect, effectContext, type TileEffectContext } from '@/game/TileEffects';

// ─── Ultimate Monopoly ────────────────────────────────────────────────────────
// The board the engine was extended for. What is checked here is the *game* —
// that its 120 tiles hang together, that its economy is the one the rules
// describe, and that the rules it reduces are reduced on purpose. How its three
// tracks are walked is `movement.test.ts`.

let board: Board;

beforeEach(() => {
  const game = gameById('ultimate');
  board = new Board(game.map, rulesFor(game));
});
afterEach(() => { unloadGame(); });

describe('Ultimate Monopoly — the board', () => {
  it('validates as a game once its own registrations are in force', () => {
    expect(validateGame(gameById('ultimate'))).toEqual([]);
  });

  it('is 120 tiles: 40 middle, 56 outer, 24 inner', () => {
    expect(board.size).toBe(120);
    expect(board.tracks.map((t) => t.count)).toEqual([40, 56, 24]);
  });

  it('starts at GO, because a player starts at tile 0', () => {
    expect(board.anchor('start')).toBe(0);
    expect(board.getTile(0).type).toBe('go');
    expect(new Player('p1', 'P1', 'car', 0).position).toBe(0);
  });

  it('has the four railroads doing double duty as junctions', () => {
    const rails = board.tiles.filter((t) => t.type === 'railroad');
    const cabs  = board.tiles.filter((t) => t.type === 'cabCompany');
    expect(rails).toHaveLength(4);
    expect(cabs).toHaveLength(4);

    // Every junction has a railroad on one side and a transit station on the other.
    for (const { a, b } of gameById('ultimate').map.junctions!) {
      const types = [board.getTile(a).type, board.getTile(b).type].sort();
      expect(types).toEqual(['railroad', 'transit']);
    }
  });

  it('has eight utilities and twenty colour groups', () => {
    expect(board.tiles.filter((t) => t instanceof UtilityTile)).toHaveLength(8);

    const groups = new Set(
      board.tiles.filter((t): t is PropertyTile => t instanceof PropertyTile)
        .map((t) => t.group),
    );
    expect(groups.size).toBe(20);
  });

  it('has 64 lots, the number of title deeds the rules list', () => {
    expect(board.tiles.filter((t) => t instanceof PropertyTile)).toHaveLength(64);
  });

  it('gives every ownable tile a price', () => {
    const priceless = board.tiles.filter((t) => isOwnable(t) && !t.price);
    expect(priceless.map((t) => t.name)).toEqual([]);
  });

  it('has exactly one jail and one go-to-jail, on different tracks', () => {
    expect(board.tiles.filter((t) => t.type === 'jail')).toHaveLength(1);
    expect(board.tiles.filter((t) => t.type === 'goToJail')).toHaveLength(1);
    expect(board.trackOf(board.anchor('jail')).id).toBe('middle');
    expect(board.trackOf(board.anchor('goToJail')).id).toBe('inner');
  });
});

describe('Ultimate Monopoly — rent', () => {
  const owner = () => new Player('p1', 'Owner', 'car', 5000);

  it('counts cab companies and railroads separately', () => {
    const p = owner();
    const cabs  = board.tiles.filter((t) => t.type === 'cabCompany');
    const rails = board.tiles.filter((t) => t.type === 'railroad');

    // Hold every cab and nothing else: the cabs charge their top rate and the
    // railroads are untouched. This is the assertion the `tile.type` change in
    // `quoteRent` exists for.
    for (const cab of cabs) {
      (cab as RailroadTile).ownerId = p.id;
      p.ownedTileIds.add(cab.id);
    }
    expect(quoteRent(board, cabs[0], p, { diceTotal: 7 }).amount).toBe(LADDERS.cab[3]);
    expect(quoteRent(board, rails[0], p, { diceTotal: 7 }).amount).toBe(25);
  });

  it('climbs an eight-rung utility ladder', () => {
    const p = owner();
    const utils = board.tiles.filter((t): t is UtilityTile => t instanceof UtilityTile);

    for (const [i, expected] of LADDERS.utility.entries()) {
      utils[i].ownerId = p.id;
      p.ownedTileIds.add(utils[i].id);
      expect(quoteRent(board, utils[0], p, { diceTotal: 10 }).amount).toBe(expected * 10);
    }
  });

  it('pays double for a majority and triple for the whole group', () => {
    const p = owner();
    // Atlanta has four lots, so a majority is three of them.
    const group = board.groupTiles('atlanta');
    expect(group).toHaveLength(4);

    // The tier, not `currentRent` — that reads 0 until the lot has an owner.
    const bare = group[0].rentTiers[0];
    for (const lot of group.slice(0, 3)) {
      lot.ownerId = p.id;
      p.ownedTileIds.add(lot.id);
    }
    expect(quoteRent(board, group[0], p, { diceTotal: 7 }).amount).toBe(bare * 2);

    group[3].ownerId = p.id;
    p.ownedTileIds.add(group[3].id);
    expect(quoteRent(board, group[0], p, { diceTotal: 7 }).amount).toBe(bare * 3);
  });

  /**
   * "If a color group has *more than two* properties… that is called a MAJORITY
   * OWNERSHIP." So three lots is enough for one, and two lots is not — holding
   * one of the browns is just holding one of the browns.
   */
  it('gives no majority in a two-lot group, where it would mean holding one', () => {
    const p = owner();
    const group = board.groupTiles('brown');
    expect(group).toHaveLength(2);

    const bare = group[0].rentTiers[0];
    group[0].ownerId = p.id;
    p.ownedTileIds.add(group[0].id);
    expect(quoteRent(board, group[0], p, { diceTotal: 7 }).amount).toBe(bare);
  });

  it('gives a majority in a three-lot group, which is two of them', () => {
    const p = owner();
    const group = board.groupTiles('losAngeles');
    expect(group).toHaveLength(3);

    const bare = group[0].rentTiers[0];
    group[0].ownerId = p.id;
    group[1].ownerId = p.id;
    p.ownedTileIds.add(group[0].id);
    p.ownedTileIds.add(group[1].id);
    expect(quoteRent(board, group[0], p, { diceTotal: 7 }).amount).toBe(bare * 2);
  });
});

describe('Ultimate Monopoly — the rules it is played by', () => {
  it('is played with tracks, the speed die and a round limit', () => {
    const rules = rulesFor(ULTIMATE_GAME);
    expect(rules.movement).toBe('tracks');
    expect(rules.variants).toContain('speedDie');
    expect(rules.winCondition).toBe('roundLimit');
    expect(rules.monopolyRent).toBe(3);
    expect(rules.majorityRent).toBe(2);
    // Tax Refund takes half the pool, so the pool has to exist.
    expect(rules.freeParkingJackpot).toBe(true);
  });

  it('re-points "Advance to Reading Railroad" at the railroad, not the station it left', () => {
    const card = ULTIMATE_GAME.cards!.chance.find((c) => c.id === 'ch12')!;
    const tile = (card.action as { tile: number }).tile;
    expect(board.getTile(tile).name).toBe('Reading Railroad');
    expect(board.trackOf(tile).id).toBe('outer');
  });

  it('has a handler for every effect its tiles ask for', () => {
    const asked = new Set(
      board.tiles.map((t) => t.type).filter((t) => EFFECT_TILE_TYPES.includes(t as never)),
    );
    for (const effect of asked) {
      expect(knownTileEffects(), `no handler for "${effect}"`).toContain(effect);
    }
    // And the list the tests read is the list the board actually uses.
    expect(asked.size).toBe(EFFECT_TILE_TYPES.length);
  });

  it('has a pay corner on each track, so a lap of any of them pays', () => {
    const payers = board.tiles.filter(
      (t) => t.type === 'go' || t.type === 'payDay' || t.type === 'bonus',
    );
    expect(payers.map((t) => board.trackOf(t.id).id).sort())
      .toEqual(['inner', 'middle', 'outer']);
  });

  /**
   * The two shapes a pay corner takes, and the reason they are worth reading
   * together. BONUS charges more for stopping, so `onLand` pays the difference.
   * PAY DAY charges by the *roll* — the same whether you stop or walk over — so
   * `onLand` pays nothing extra.
   */
  it('pays more for stopping on Bonus', () => {
    expect(LADDERS.bonus.landing).toBeGreaterThan(LADDERS.bonus.passing);
  });

  describe('Pay Day pays by the roll, not by whether you stopped', () => {
    const payDayId = () => board.tiles.find((t) => t.type === 'payDay').id;

    /** Every `rent:pay` a walk over one tile produces. */
    function paidFor(roll: number | null): number[] {
      const paid: number[] = [];
      const off = bus.on<{ amount: number; creditorId: string }>(
        'rent:pay', (p) => { if (p.creditorId === 'p1') paid.push(p.amount); },
      );
      board.announcePassing([payDayId()], 'p1', { roll });
      off?.();
      return paid;
    }

    it('pays $300 for an odd roll and $400 for an even one', () => {
      expect(paidFor(7)).toEqual([LADDERS.payDay.odd]);
      expect(paidFor(8)).toEqual([LADDERS.payDay.even]);
      expect(LADDERS.payDay.odd).toBe(300);
      expect(LADDERS.payDay.even).toBe(400);
    });

    /**
     * "If you move directly to PAY DAY (via an ACTION CARD or TRAVEL SPACE) you
     * collect $400, regardless of what you rolled previously." A direct move is
     * the one that reports no roll, which is every mover in the build but the
     * dice.
     */
    it('pays the maximum when the dice are not what moved you', () => {
      expect(paidFor(null)).toEqual([LADDERS.payDay.even]);
    });

    /**
     * Landing pays once, not twice. `onPass` fires for the landing tile too, so
     * a corner that charges the same for stopping must add nothing in `onLand` —
     * the trap CLAUDE.md records, and the one this square used to be an example
     * of rather than a warning against.
     */
    it('pays once when you stop on it, not the pass and a top-up', () => {
      const paid: number[] = [];
      const off = bus.on<{ amount: number; creditorId: string }>(
        'rent:pay', (p) => { if (p.creditorId === 'p1') paid.push(p.amount); },
      );
      const tile = board.getTile(payDayId());
      board.announcePassing([tile.id], 'p1', { roll: 9 });
      tile.onLand('p1');
      off?.();
      expect(paid).toEqual([LADDERS.payDay.odd]);
    });
  });

  /**
   * The mechanic works in `movement.test.ts`; this is whether it *happens*. A
   * board whose junctions were never reached in play would pass every unit test
   * and still be a 40-tile game with 80 tiles of scenery, so a real played-out
   * game has to put deeds on all three tracks.
   */
  it('is actually played on all three tracks', () => {
    const result = simulate({ game: 'ultimate', seed: 7, players: 4, checkInvariants: true });
    expect(result.violations).toEqual([]);

    const played = new Board(gameById('ultimate').map, rulesFor(ULTIMATE_GAME));
    const reached = new Set(
      result.tilesOwned.map((id) => played.trackOf(id).id),
    );
    expect([...reached].sort()).toEqual(['inner', 'middle', 'outer']);
  });

  // ─── The build ladder ───────────────────────────────────────────────────────
  // Five things can be built here, in the two shapes M12d's ladder exists to
  // tell apart: rungs that add a rent tier, and improvements that multiply.

  describe('what can be built on it', () => {
    let bank: Bank;
    let ann: Player;

    beforeEach(() => {
      bank = new Bank(board.rules);
      ann  = new Player('p1', 'Ann', 'car', false, 20_000);
    });

    const own = (tile: { id: number; ownerId: string | null }) => {
      tile.ownerId = ann.id;
      ann.ownedTileIds.add(tile.id);
    };

    it('stocks the box the printed equipment list names', () => {
      expect(bank.stock).toMatchObject({
        house: 81, hotel: 31, skyscraper: 16, trainDepot: 4, cabStand: 4,
      });
    });

    /**
     * "If you own all of the properties of a color group, and have built hotels
     * on each, you may then build Skyscrapers." So a lot climbs six rungs here
     * where the classic board stops at five.
     */
    it('builds a skyscraper on top of a hotel', () => {
      const group = board.groupTiles('brown');
      for (const lot of group) own(lot);
      const lot = group[0];

      expect(topLevel(board.rules.buildLadder, lot.type)).toBe(6);

      // Everything up to the hotel, evenly across the group.
      for (let rung = 1; rung <= 5; rung++) {
        for (const member of group) expect(bank.build(ann, member)).toBe(true);
      }
      expect(group.every((m) => m.level === 5)).toBe(true);

      expect(rungAt(board.rules.buildLadder, lot.type, 6)?.kind.id).toBe('skyscraper');
      expect(canBuild(board, bank, ann, lot).ok).toBe(true);
      expect(bank.build(ann, lot)).toBe(true);
      expect(lot.level).toBe(6);
      expect(bank.stock.skyscraper).toBe(15);
    });

    it('charges the seventh rent tier for one', () => {
      const lot = board.groupTiles('brown')[0] as PropertyTile;
      expect(lot.rentTiers).toHaveLength(7);
      lot.ownerId = ann.id;
      lot.level = 6;
      expect(lot.currentRent).toBe(lot.rentTiers[6]);
      expect(lot.rentTiers[6]).toBeGreaterThan(lot.rentTiers[5]);
    });

    it('sells a skyscraper back into a hotel', () => {
      const lot = board.groupTiles('brown')[0];
      own(lot);
      lot.level = 6;
      bank.stock.skyscraper = 15;
      expect(bank.sell(ann, lot)).toBe(true);
      expect(lot.level).toBe(5);
      expect(bank.stock.skyscraper).toBe(16);
    });

    /**
     * The other shape. "You may improve your Railroads by building a Train Depot
     * on it (cost: $100). A Train Depot doubles the rent due for the Railroad.
     * You don't need to own multiple Railroads before building one."
     */
    it('puts a train depot on a single railroad, with no group to complete', () => {
      const rail = board.tiles.find((t) => t.type === 'railroad')!;
      own(rail as never);

      expect(canBuild(board, bank, ann, rail as never).ok).toBe(true);
      expect(bank.priceOf(rail as never, 1)).toBe(100);
      expect(bank.build(ann, rail as never)).toBe(true);
      expect(bank.stock.trainDepot).toBe(3);
    });

    it('doubles what the railroad charges, rather than adding a tier', () => {
      const rails = board.tiles.filter((t) => t.type === 'railroad');
      const rail = rails[0];
      own(rail as never);

      const bare = quoteRent(board, rail, ann, { diceTotal: 7 }).amount;
      (rail as never as { level: number }).level = 1;
      const improved = quoteRent(board, rail, ann, { diceTotal: 7 });
      expect(improved.amount).toBe(bare * 2);
      expect(improved.notes.join()).toMatch(/train depot/i);
    });

    it('sells a depot back for the price the rules print', () => {
      const rail = board.tiles.find((t) => t.type === 'railroad')!;
      own(rail as never);
      (rail as never as { level: number }).level = 1;
      bank.stock.trainDepot = 3;
      const cash = ann.cash;
      expect(bank.sell(ann, rail as never)).toBe(true);
      expect(ann.cash).toBe(cash + 50);
      expect(bank.stock.trainDepot).toBe(4);
    });

    it('puts a cab stand on a cab company at its own price', () => {
      const cab = board.tiles.find((t) => t.type === 'cabCompany')!;
      own(cab as never);
      expect(bank.priceOf(cab as never, 1)).toBe(150);
      expect(bank.build(ann, cab as never)).toBe(true);
      expect(bank.stock.cabStand).toBe(3);
    });

    /** A depot belongs on a railroad and nowhere else. */
    it('refuses to build on a tile no level names', () => {
      const util = board.tiles.find((t) => t.type === 'utility')!;
      own(util as never);
      expect(topLevel(board.rules.buildLadder, util.type)).toBe(0);
      const check = canBuild(board, bank, ann, util as never);
      expect(check.ok).toBe(false);
      expect(check.reason).toMatch(/Nothing can be built/);
    });
  });

  // ─── Direct movement ────────────────────────────────────────────────────────
  // "Since traveling via Subway is a direct route, you do not collect any salary
  // for passing a PAY CORNER (if you choose to move directly to a PAY CORNER
  // from the Subway, you collect the largest amount of salary from that space)."

  describe('travel is direct, and direct means no salary on the way', () => {
    /** Every payment made to p1 while `run` executes. */
    function paidDuring(run: () => void): number[] {
      const paid: number[] = [];
      const off = bus.on<{ amount: number; creditorId: string }>(
        'rent:pay', (e) => { if (e.creditorId === 'p1') paid.push(e.amount); },
      );
      run();
      off?.();
      return paid;
    }

    const payCorner = () => board.tiles.find((t) => t.type === 'payDay')!.id;

    it('pays nothing for a pay corner flown over', () => {
      const player = new Player('p1', 'Ann', 'car', false, 100);
      const start = board.anchor('start');
      // Three back from GO, to three past it: a route that certainly crosses it,
      // and ends on an ordinary square that pays nothing of its own.
      const from = board.move(start, -3).to;
      const to   = board.move(start, 3).to;

      player.position = from;
      const walked = paidDuring(() => walkTo(board, player, to));
      player.position = from;
      const direct = paidDuring(() => walkTo(board, player, to, { direct: true }));

      // Walking over GO collects the salary; flying over it collects nothing.
      expect(walked).toEqual([board.rules.goSalary]);
      expect(direct).toEqual([]);
    });

    /**
     * The other half of the same rule: arriving still pays, and pays the
     * *maximum*, because a direct arrival reports no roll.
     */
    it('pays the pay corner it arrives on, at its highest rate', () => {
      const player = new Player('p1', 'Ann', 'car', false, 100);
      player.position = board.anchor('start');
      const paid = paidDuring(() => walkTo(board, player, payCorner(), { direct: true }));
      expect(paid).toEqual([LADDERS.payDay.even]);
    });
  });

  // ─── Majority ownership ─────────────────────────────────────────────────────
  // "If a color group has more than two properties, you may build houses and
  // hotels once you own all but one property in that color group."

  describe('building on a majority', () => {
    let bank: Bank;
    let ann: Player;
    let bo: Player;

    beforeEach(() => {
      bank = new Bank(board.rules);
      ann  = new Player('p1', 'Ann', 'car', false, 20_000);
      bo   = new Player('p2', 'Bo', 'dog', false, 20_000);
    });

    /** A colour group with more than two lots, and one with exactly two. */
    const bigGroup = () => board.tiles
      .filter(isProperty)
      .map((t) => t.group)
      .find((g) => board.groupTiles(g).length > 2)!;

    const give = (tile: { id: number; ownerId: string | null }, who: Player) => {
      tile.ownerId = who.id;
      who.ownedTileIds.add(tile.id);
    };

    it('lets you build with all but one of a group of three or more', () => {
      const group = board.groupTiles(bigGroup());
      group.slice(0, -1).forEach((lot) => give(lot, ann));
      give(group[group.length - 1], bo);   // the odd one out is somebody else's

      expect(ownsWholeGroup(board, ann, group[0])).toBe(false);
      expect(ownsMajority(board, ann, group[0])).toBe(true);
      expect(canBuild(board, bank, ann, group[0]).ok).toBe(true);
    });

    /**
     * Even building is measured over the lots you *hold*. Counting the one you
     * do not would pin the group at level 0 for ever, since it can never be
     * built on — which is the trap this rule walks straight into.
     */
    it('keeps building even across the lots you hold, not the whole group', () => {
      const group = board.groupTiles(bigGroup());
      const mine  = group.slice(0, -1);
      mine.forEach((lot) => give(lot, ann));
      give(group[group.length - 1], bo);

      expect(bank.build(ann, mine[0])).toBe(true);
      // The second of mine is behind, so it is next; the first is not.
      expect(canBuild(board, bank, ann, mine[0]).ok).toBe(false);
      expect(canBuild(board, bank, ann, mine[1]).ok).toBe(true);
    });

    it('still wants both lots of a group of two', () => {
      const pair = board.tiles.filter(isProperty)
        .map((t) => t.group)
        .find((g) => board.groupTiles(g).length === 2);
      if (!pair) return;   // not every board has one

      const group = board.groupTiles(pair);
      give(group[0], ann);
      give(group[1], bo);
      expect(ownsMajority(board, ann, group[0])).toBe(false);
      expect(canBuild(board, bank, ann, group[0]).ok).toBe(false);
    });

    /** The skyscraper is the exception the rule names: it wants the monopoly. */
    it('refuses a skyscraper on a majority, however tall the rest is', () => {
      const group = board.groupTiles(bigGroup());
      const mine  = group.slice(0, -1);
      mine.forEach((lot) => give(lot, ann));
      give(group[group.length - 1], bo);

      for (const lot of mine) lot.level = 5;      // hotels on everything of mine
      const check = canBuild(board, bank, ann, mine[0]);
      expect(rungAt(board.rules.buildLadder, mine[0].type, 6)?.kind.id).toBe('skyscraper');
      expect(check.ok).toBe(false);
      expect(check.reason).toMatch(/every lot in the colour group/);

      // Buy the last one, and it is allowed.
      bo.ownedTileIds.delete(group[group.length - 1].id);
      give(group[group.length - 1], ann);
      group[group.length - 1].level = 5;
      expect(canBuild(board, bank, ann, mine[0]).ok).toBe(true);
    });

    it("is not somebody else's mortgage that stops you", () => {
      const group = board.groupTiles(bigGroup());
      const mine  = group.slice(0, -1);
      mine.forEach((lot) => give(lot, ann));
      const theirs = group[group.length - 1];
      give(theirs, bo);
      theirs.isMortgaged = true;

      expect(canBuild(board, bank, ann, mine[0]).ok).toBe(true);
    });
  });

  // ─── Spending one ───────────────────────────────────────────────────────────
  // Valuing a holding generalises and playing one does not, so *when* to play a
  // travel voucher is the game's own policy — `Game.botSpends`.

  describe('a bot spending a voucher', () => {
    const game = () => gameById('ultimate');

    function seat(vouchers: number, cash = 5_000): Player {
      const p = new Player('p1', 'Ann', 'car', true, cash);
      giveHolding(p, 'travelVoucher', vouchers);
      return p;
    }

    it('declares how a voucher is played, so both drivers agree', () => {
      expect(game().spendable).toEqual({ travelVoucher: 'playVoucher' });
    });

    it('plays one when there is an unowned deed it could pay for', () => {
      const player = seat(2);
      expect(game().botSpends!({ board, player, players: [player] })).toBe('travelVoucher');
    });

    /** The last one is kept: it is worth $60 in an estate and trades well. */
    it('keeps its last voucher rather than spending down to nothing', () => {
      const player = seat(1);
      expect(game().botSpends!({ board, player, players: [player] })).toBeNull();
    });

    it('does not play one it cannot follow up', () => {
      const player = seat(3, 0);   // nothing is affordable
      expect(game().botSpends!({ board, player, players: [player] })).toBeNull();
    });

    it('holds off once every deed is taken', () => {
      const player = seat(3);
      for (const tile of board.tiles) if (isOwnable(tile)) tile.ownerId = 'p9';
      expect(game().botSpends!({ board, player, players: [player] })).toBeNull();
    });

    /**
     * The rule every bot decision in this repo obeys: no randomness, or a seeded
     * game stops replaying (invariant 3).
     */
    it('is a pure function of the state', () => {
      const player = seat(2);
      const ctx = { board, player, players: [player] };
      const answers = Array.from({ length: 8 }, () => game().botSpends!(ctx));
      expect(new Set(answers).size).toBe(1);
    });
  });

  it('keeps its registrations to itself', () => {
    // `utility` is replaced by the eight-rung one *while this game is loaded*.
    expect(board.tiles.find((t) => t.type === 'utility')).toBeInstanceOf(UtilityTile);
    unloadGame();
    gameById('classic');
    expect(knownTileEffects()).not.toContain('squeezePlay');
  });
});

// ─── The two rules that stopped being deterministic ───────────────────────────

describe('Subway and the Auction square ask, rather than decide', () => {
  /** Answer the next choice with whatever `pick` returns; report what was asked. */
  function intercept(pick: (r: ChoiceRequest) => string) {
    const seen: ChoiceRequest[] = [];
    bus.on<ChoiceRequest>('choice:ask', (request) => {
      seen.push(request);
      request.answer(pick(request));
    });
    return seen;
  }

  function landOn(type: string, player: Player, ctx: TileEffectContext): number {
    const tile = board.tiles.find((t) => t.type === type)!;
    player.position = tile.id;
    applyTileEffect(ctx, { playerId: player.id, tileId: tile.id, effect: type });
    return tile.id;
  }

  let ann: Player;
  let ctx: TileEffectContext;

  beforeEach(() => {
    ann = new Player('p1', 'Ann', 'car', false, 1500);
    const bank = new Bank(board.rules);
    ctx = effectContext({
      board, bank, players: [ann], rules: board.rules, dice: new Dice(),
    });
  });
  afterEach(() => bus.off('choice:ask'));

  it('offers the Subway every square but the one you are standing on', () => {
    const asked = intercept((r) => r.options[0].id);
    // Captured before the effect runs: answering it walks the player, so reading
    // `ann.position` afterwards would be reading the *destination*.
    const stoodOn = landOn('subway', ann, ctx);

    expect(asked).toHaveLength(1);
    expect(asked[0].style).toBe('board');
    expect(asked[0].options).toHaveLength(board.size - 1);
    expect(asked[0].options.some((o) => o.tileId === stoodOn)).toBe(false);
  });

  /**
   * The point of the rewrite: the old deterministic answer is what a *bot* now
   * picks, and a person gets the choice. So the weights have to reproduce it.
   */
  it('leaves a bot picking the dearest unowned deed, as it used to', () => {
    const asked = intercept((r) => preferredOption(r).id);
    landOn('subway', ann, ctx);

    const chosen = board.getTile(Number(preferredOption(asked[0]).id));
    expect(isOwnable(chosen)).toBe(true);
    expect((chosen as { ownerId: string | null }).ownerId).toBeNull();

    const dearest = Math.max(
      ...board.tiles.filter((t) => isOwnable(t) && t.ownerId === null).map((t) => t.price),
    );
    expect((chosen as { price: number }).price).toBe(dearest);
  });

  it('offers the Auction square only the deeds nobody owns', () => {
    const owned = board.tiles.find((t) => isOwnable(t))!;
    (owned as { ownerId: string | null }).ownerId = ann.id;

    const asked = intercept((r) => r.options[0].id);
    landOn('auctionAny', ann, ctx);

    expect(asked).toHaveLength(1);
    expect(asked[0].options.every((o) => {
      const tile = board.getTile(o.tileId!);
      return isOwnable(tile) && tile.ownerId === null;
    })).toBe(true);
    expect(asked[0].options.some((o) => o.tileId === owned.id)).toBe(false);
  });

  /**
   * It used to emit `property:auction`, which offers the deed to the player who
   * nominated it *before* anybody bids — first refusal on your own nomination,
   * which is close to the opposite of "the Banker auctions it off".
   */
  it('sends the nominated deed straight under the hammer', () => {
    let opened: { subject: { id: number } } | null = null;
    let offered = false;
    bus.on<{ subject: { id: number } }>('auction:open', (p) => { opened = p; });
    bus.on('property:auction', () => { offered = true; });

    const asked = intercept((r) => r.options[0].id);
    landOn('auctionAny', ann, ctx);

    expect(offered).toBe(false);
    expect(opened).not.toBeNull();
    expect(opened!.subject.id).toBe(Number(asked[0].options[0].id));

    bus.off('auction:open');
    bus.off('property:auction');
  });
});
