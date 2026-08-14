import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bus } from '@/utils/EventBus';
import { Board } from '@/game/Board';
import { Bank } from '@/game/Bank';
import { Player } from '@/game/Player';
import { PropertyTile } from '@/tiles/PropertyTile';
import { settleDebt, mortgageTransferFee, chargeMortgageInterest } from '@/game/Estate';
import { executeTrade } from '@/game/Trade';
import { unmortgageCost, canUnmortgage } from '@/game/BuildRules';
import { askChoice, preferredOption, type ChoiceRequest } from '@/game/Choice';
import { rollRuleNamed, knownRollRules, registerRollRule } from '@/game/RollRules';
import { resolveRules } from '@/game/Rules';
import { rulesFor, GAMES } from '@/games';
import { Dice, type DiceResult } from '@/game/Dice';
import { SpeedDice, TRIPLES_RULE } from '@/game/SpeedDie';

// ─── The corners 10a squared off ──────────────────────────────────────────────
// Four places the implementation knowingly departed from the printed rules. Each
// of these is the assertion that says it does not any more.

const MEDITERRANEAN = 1;
const BALTIC = 3;
const BOARDWALK = 39;

let board: Board;
let bank: Bank;
let ann: Player;
let bo: Player;

beforeEach(() => {
  board = new Board();
  bank  = new Bank();
  ann = new Player('p1', 'Ann', 'car', 1500);
  bo  = new Player('p2', 'Bo', 'dog', 1500);
});
afterEach(() => { bus.off('choice:ask'); });

function give(player: Player, ...ids: number[]): void {
  for (const id of ids) {
    const tile = board.getTile(id) as PropertyTile;
    tile.ownerId = player.id;
    player.ownedTileIds.add(id);
  }
}

// ─── Mortgage interest ────────────────────────────────────────────────────────

describe('mortgage interest — charged on the way in as well as on the way out', () => {
  it('prices the fee off the mortgage, and off the rule', () => {
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.isMortgaged = true;
    expect(mortgageTransferFee([med], 0.1)).toBe(Math.round(med.mortgage * 0.1));
    // A game that turns interest off pays nothing for either half.
    expect(mortgageTransferFee([med], 0)).toBe(0);
  });

  it('charges nothing for a deed that is not mortgaged', () => {
    expect(mortgageTransferFee([board.getTile(BOARDWALK) as PropertyTile], 0.1)).toBe(0);
  });

  it('charges the receiver when a mortgaged deed comes over in a trade', () => {
    give(ann, MEDITERRANEAN);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.isMortgaged = true;

    const before = bo.cash;
    executeTrade(board, [ann, bo], {
      fromId: ann.id, toId: bo.id,
      fromTileIds: [MEDITERRANEAN], toTileIds: [],
      fromCash: 0, toCash: 0, fromJailCards: 0, toJailCards: 0,
    }, bank);

    expect(bo.ownedTileIds.has(MEDITERRANEAN)).toBe(true);
    expect(before - bo.cash).toBe(Math.round(med.mortgage * 0.1));
  });

  /**
   * The half that was never missing: lifting a mortgage has always cost 110%.
   * What changed is that the 10% is the rule set's number rather than a literal,
   * so one value governs both charges.
   */
  it('lifts a mortgage at the rate the rule set says', () => {
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    expect(unmortgageCost(med, 0.1)).toBe(Math.floor(med.mortgage * 1.1));
    expect(unmortgageCost(med, 0)).toBe(med.mortgage);
    expect(unmortgageCost(med, 0.5)).toBe(Math.floor(med.mortgage * 1.5));
  });

  it('refuses to lift one the player cannot afford at that rate', () => {
    give(ann, MEDITERRANEAN);
    const med = board.getTile(MEDITERRANEAN) as PropertyTile;
    med.isMortgaged = true;
    ann.cash = med.mortgage;                       // enough for 100%, not 110%
    expect(canUnmortgage(ann, med, 0.1).ok).toBe(false);
    expect(canUnmortgage(ann, med, 0).ok).toBe(true);
  });

  it('settles the fee rather than clamping it, so it can bankrupt', () => {
    give(ann, MEDITERRANEAN, BALTIC);
    for (const id of [MEDITERRANEAN, BALTIC]) {
      (board.getTile(id) as PropertyTile).isMortgaged = true;
    }
    bo.cash = 1;   // cannot cover the interest, and owns nothing to raise it with
    const owed = chargeMortgageInterest(board, bank, bo, [
      board.getTile(MEDITERRANEAN) as PropertyTile,
      board.getTile(BALTIC) as PropertyTile,
    ], 0.1);

    expect(owed).toBeGreaterThan(0);
    expect(bo.cash).toBe(0);
    expect(bo.isBankrupt).toBe(true);   // settleDebt, not `pay`, which clamps
  });

  it('is a rule value, so a game could switch it off', () => {
    expect(rulesFor(GAMES.classic).mortgageInterest).toBe(0.1);
    expect(resolveRules({ mortgageInterest: 0 }).mortgageInterest).toBe(0);
  });
});

// ─── The choice prompt ────────────────────────────────────────────────────────

describe('choices — a question a person and a bot can both answer', () => {
  const request = (over: Partial<ChoiceRequest> = {}): ChoiceRequest => ({
    id: 'test', playerId: ann.id, prompt: 'Pick one', style: 'list',
    options: [
      { id: 'a', label: 'A', weight: 1 },
      { id: 'b', label: 'B', weight: 9 },
      { id: 'c', label: 'C', weight: 5 },
    ],
    answer: () => {},
    ...over,
  });

  it('a bot takes the heaviest option', () => {
    expect(preferredOption(request()).id).toBe('b');
  });

  it('with no weights it is deterministic — the first', () => {
    expect(preferredOption(request({
      options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }],
    })).id).toBe('x');
  });

  it('reaches a listener and carries the answer back', () => {
    let answered: string | null = null;
    bus.on<ChoiceRequest>('choice:ask', (r) => r.answer('c'));

    const asked = askChoice(request({ answer: (id) => { answered = id; } }));
    expect(asked).toBe(true);
    expect(answered).toBe('c');
  });

  /**
   * A rule that asks has to survive nobody listening — a unit test, a headless
   * run with the handler not yet wired — rather than parking the turn for ever.
   */
  it('reports that nobody answered rather than hanging', () => {
    expect(askChoice(request())).toBe(true);      // emitted; simply unanswered
    expect(askChoice(request({ options: [] }))).toBe(false);
  });

  it('ignores a second answer', () => {
    let count = 0;
    bus.on<ChoiceRequest>('choice:ask', (r) => { r.answer('a'); r.answer('b'); });
    askChoice(request({ answer: () => { count++; } }));
    expect(count).toBe(1);
  });
});

// ─── What a roll means ────────────────────────────────────────────────────────

describe('roll rules — the fifth registered strategy', () => {
  const result = (die1: number, die2: number): DiceResult =>
    ({ die1, die2, isDoubles: die1 === die2, total: die1 + die2 });

  const ctx = (r: DiceResult, player = ann) => ({
    dice: new Dice(), result: r, player, board, rules: board.rules,
    choose: () => false,
  });

  it('ships the classic rule, and the speed die brings another', () => {
    expect(knownRollRules()).toContain('classic');
  });

  it('moves the total, and rolls again on doubles', () => {
    expect(rollRuleNamed('classic')(ctx(result(3, 4))))
      .toEqual({ kind: 'move', steps: 7, again: false });
    expect(rollRuleNamed('classic')(ctx(result(4, 4))))
      .toEqual({ kind: 'move', steps: 8, again: true });
  });

  it('sends the third pair in a row to jail, and resets the streak', () => {
    const classic = rollRuleNamed('classic');
    classic(ctx(result(2, 2)));
    classic(ctx(result(3, 3)));
    expect(ann.doublesStreak).toBe(2);

    expect(classic(ctx(result(5, 5)))).toEqual({ kind: 'jail' });
    expect(ann.doublesStreak).toBe(0);
  });

  it('clears the streak on anything that is not a pair', () => {
    const classic = rollRuleNamed('classic');
    classic(ctx(result(2, 2)));
    classic(ctx(result(1, 6)));
    expect(ann.doublesStreak).toBe(0);
  });

  it('takes one a game registers, and refuses one it has not', () => {
    registerRollRule('alwaysJail', () => ({ kind: 'jail' }));
    expect(rollRuleNamed('alwaysJail')(ctx(result(1, 2)))).toEqual({ kind: 'jail' });
    expect(() => rollRuleNamed('nonesuch')).toThrow(/nonesuch/);
  });
});

// ─── The contested-house lot ──────────────────────────────────────────────────

describe('a bankrupt estate still balances once interest is charged', () => {
  it('leaves the debtor with nothing and the creditor out of pocket', () => {
    ann.cash = 10;
    give(ann, MEDITERRANEAN, BALTIC);
    const before = bo.cash;

    settleDebt(board, bank, ann, bo, 5_000);

    expect(ann.ownedTileIds.size).toBe(0);
    expect(bo.ownedTileIds.size).toBe(2);
    // Raised $70 from the fire sale, then paid interest on both mortgaged deeds.
    const interest = mortgageTransferFee([
      board.getTile(MEDITERRANEAN) as PropertyTile,
      board.getTile(BALTIC) as PropertyTile,
    ], 0.1);
    expect(bo.cash).toBe(before + 70 - interest);
  });
});

// ─── The speed die's triples ──────────────────────────────────────────────────

describe('triples — deferred from 8b, and why it could land in 10a', () => {
  const result = (die1: number, die2: number): DiceResult =>
    ({ die1, die2, isDoubles: die1 === die2, total: die1 + die2 });

  /** A speed die showing `face`, without spending the PRNG to get there. */
  function speedShowing(face: number | null): SpeedDice {
    const dice = new SpeedDice();
    dice.lastNumber = face;
    return dice;
  }

  const ctx = (dice: SpeedDice, r: DiceResult, choose = () => false) =>
    ({ dice, result: r, player: ann, board, rules: board.rules, choose });

  it('is selected by turning the variant on, not by hand', () => {
    // The gap this closes: before M10a a variant could *register* a rule and had
    // no way to select it, so the triples rule would have sat there unused.
    expect(rulesFor(GAMES.classic).rollRule).toBe('classic');
    expect(rulesFor(GAMES.speed).rollRule).toBe(TRIPLES_RULE);
  });

  it('a player’s own choice still outranks what the variant brings', () => {
    expect(rulesFor(GAMES.speed, { rollRule: 'classic' }).rollRule).toBe('classic');
  });

  it('asks where to go when all three dice match', () => {
    let prompted: string | null = null;
    const outcome = rollRuleNamed(TRIPLES_RULE)(
      ctx(speedShowing(2), result(2, 2), (prompt) => { prompted = prompt; return true; }),
    );
    expect(outcome).toEqual({ kind: 'handled' });
    expect(prompted).toMatch(/Triple 2/);
  });

  it('offers every tile on the board, weighted by price', () => {
    let options: Array<{ id: string; weight?: number }> = [];
    rollRuleNamed(TRIPLES_RULE)(ctx(speedShowing(3), result(3, 3), ((_p, o) => {
      options = o;
      return true;
    }) as never));
    expect(options).toHaveLength(board.size);
    // Boardwalk is the dearest thing on the classic board, so a bot takes it.
    expect(Number(preferredOption({
      id: 't', playerId: ann.id, prompt: '', style: 'board',
      options: options as never, answer: () => {},
    }).id)).toBe(BOARDWALK);
  });

  /**
   * "You do not go to jail if you've rolled DOUBLES twice before rolling
   * TRIPLES." The streak is cleared *before* the classic rule could see it.
   */
  it('a triple after two doubles does not go to jail', () => {
    ann.doublesStreak = 2;
    const outcome = rollRuleNamed(TRIPLES_RULE)(
      ctx(speedShowing(1), result(1, 1), () => true),
    );
    expect(outcome).toEqual({ kind: 'handled' });
    expect(ann.doublesStreak).toBe(0);
  });

  it('falls back to the classic rule when the dice are not a triple', () => {
    // A pair, but the speed die shows something else.
    expect(rollRuleNamed(TRIPLES_RULE)(ctx(speedShowing(3), result(2, 2))))
      .toEqual({ kind: 'move', steps: 4, again: true });
    // A picture face is not a number and cannot be part of a triple.
    expect(rollRuleNamed(TRIPLES_RULE)(ctx(speedShowing(null), result(2, 2))))
      .toEqual({ kind: 'move', steps: 4, again: true });
  });

  /** Nobody listening must not park the turn — it moves normally instead. */
  it('moves normally when there is nowhere to send the question', () => {
    expect(rollRuleNamed(TRIPLES_RULE)(ctx(speedShowing(2), result(2, 2), () => false)))
      .toEqual({ kind: 'move', steps: 4, again: true });
  });
});
