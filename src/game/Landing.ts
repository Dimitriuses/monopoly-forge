import { quoteRent, type ArrivalRent } from './Rent';
import { settleDebt, announceSettlement, type Settlement } from './Estate';
import type { Board } from './Board';
import type { Bank } from './Bank';
import type { Dice } from './Dice';
import type { Player } from './Player';
import type { GameRules } from './Rules';
import type { Card, CardDeck, CardEffects } from '@/cards/CardDeck';

// ─── Landing ──────────────────────────────────────────────────────────────────
// What a tile *costs* when somebody stops on it, resolved in the model.
//
// This is the piece M8d could not do without. `GameScene` used to hold all of
// it: quote the rent, settle the debt, pot the tax, draw and execute a card —
// interleaved with toasts, sound and `safeEndTurn(700)`. A headless runner
// cannot reuse a scene, so either the rules got a second implementation inside
// the simulator, or they moved somewhere both could reach. They moved.
//
// What stays with each driver is *timing*, which is the honest division:
//
//   * `GameScene` waits a beat after a landing so a person can read what
//     happened, because its landings are animated.
//   * The runner ends the turn the instant the landing returns, because there is
//     no tween to be slower than and no clock to wait on.
//
// So a landing no longer *is* a delay — it is a function that returns, and the
// driver decides what to do with the moment afterwards.

export interface LandingContext {
  board: Board;
  bank: Bank;
  players: Player[];
  rules: GameRules;
  dice: Dice;
}

export interface RentPayload {
  debtorId: string;
  creditorId: string;
  amount?: number;
  tileId: number;
  reason?: string;
}

export type RentOutcome =
  /** The GO salary, paid *during* a move — the turn carries on regardless. */
  | { kind: 'salary'; player: Player; amount: number }
  | { kind: 'rent'; debtor: Player; creditor: Player; amount: number;
      notes: string[]; settlement: Settlement }
  /** Somebody in the payload is not at this table. */
  | { kind: 'none' };

/**
 * Charge what a tile asks. `arrival` is the rate a card imposed on the way here
 * — double on a railroad, ten times the dice on a utility — and is consumed by
 * whoever calls this; the caller clears it afterwards.
 */
export function payRent(
  ctx: LandingContext, payload: RentPayload, arrival: ArrivalRent | null,
): RentOutcome {
  const { debtorId, creditorId, amount, tileId, reason } = payload;

  // The salary fires from `onPass` in the middle of a walk, so it must return
  // before anything consumes the arrival rate the landing still needs.
  if (reason === 'go') {
    const player = ctx.players.find((p) => p.id === creditorId);
    if (!player) return { kind: 'none' };
    ctx.bank.payPlayer(player, amount ?? 0);
    return { kind: 'salary', player, amount: amount ?? 0 };
  }

  const debtor   = ctx.players.find((p) => p.id === debtorId);
  const creditor = ctx.players.find((p) => p.id === creditorId);
  if (!debtor || !creditor) return { kind: 'none' };

  const { amount: resolved, notes } = quoteRent(
    ctx.board, ctx.board.getTile(tileId), creditor,
    { diceTotal: ctx.dice.lastResult?.total ?? 7, arrival, declared: amount },
  );

  // Settlement, not a clamped subtraction: a debtor who cannot pay sells and
  // mortgages first, and only then goes under, handing over their estate.
  const settlement = settleDebt(ctx.board, ctx.bank, debtor, creditor, resolved);
  announceSettlement(debtor, creditor, settlement);
  return { kind: 'rent', debtor, creditor, amount: resolved, notes, settlement };
}

/** Charge a tax. Under the Free Parking house rule it pools instead of vanishing. */
export function payTax(
  ctx: LandingContext, playerId: string, amount: number,
): { player: Player; settlement: Settlement } | null {
  const player = ctx.players.find((p) => p.id === playerId);
  if (!player) return null;

  const settlement = settleDebt(ctx.board, ctx.bank, player, null, amount);
  if (ctx.rules.freeParkingJackpot) ctx.bank.addToPot(settlement.paid);
  announceSettlement(player, null, settlement);
  return { player, settlement };
}

/**
 * What a *free* landing pays — Go, Just Visiting, Free Parking, your own deed.
 * Both house rules that turn on where you stopped live here, so a driver only
 * has to report what happened rather than work out whether it did.
 */
export function applyLandingRules(
  ctx: LandingContext, playerId: string, tileId: number,
): { jackpot: number; doubleSalary: number } {
  const player = ctx.players.find((p) => p.id === playerId);
  if (!player) return { jackpot: 0, doubleSalary: 0 };

  const tile = ctx.board.getTile(tileId);
  let jackpot = 0;
  let doubleSalary = 0;

  if (ctx.rules.freeParkingJackpot && tile.type === 'freeParking' && ctx.bank.pot > 0) {
    jackpot = ctx.bank.takePot(player);
  }

  // Passing GO already paid the salary; landing exactly on it pays it twice.
  if (ctx.rules.doubleGoSalary && tileId === ctx.board.anchor('start')) {
    doubleSalary = ctx.rules.goSalary;
    ctx.bank.payPlayer(player, doubleSalary);
  }

  return { jackpot, doubleSalary };
}

// ─── Cards ────────────────────────────────────────────────────────────────────

/**
 * Actions that resolve their own turn end — through the movement they cause, or
 * through `jail:enter`. A driver that also ended the turn for these would race
 * the move and land the *next* player on the tile.
 */
export const SELF_TERMINATING = [
  'advanceTo', 'advanceToNearest', 'advanceToGo', 'goBack', 'goToJail',
] as const;

export function isSelfTerminating(card: Card): boolean {
  return (SELF_TERMINATING as readonly string[]).includes(card.action.type);
}

/**
 * Take the top card and put it back. The return happens *now*, before anything
 * shows it: a card returned from a callback that never runs is lost, and both
 * decks eventually drain to nothing. A Get Out of Jail Free card is the
 * exception — the player holds it until it is spent.
 */
export function drawCard(deck: CardDeck): Card | null {
  const card = deck.drawCard();
  if (!card) return null;
  if (!card.isGetOutOfJail) deck.returnCard(card);
  return card;
}

/** Apply a card. Separate from drawing it, because a UI shows it in between. */
export function playCard(effects: CardEffects, card: Card, player: Player): void {
  effects.execute(card, player);
}
