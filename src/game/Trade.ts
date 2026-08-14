import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable, type Ownable, type Tile } from '@/tiles/Tile';
import { groupBuildingCount } from './BuildRules';
import { chargeMortgageInterest } from './Estate';
import type { Bank } from './Bank';
import type { Board } from './Board';
import type { Player } from './Player';

// ─── Trade ────────────────────────────────────────────────────────────────────
// A two-sided swap of deeds, cash and Get Out of Jail Free cards. Both halves are
// described up front and applied at once, so a trade can never half-happen: it is
// checked in full, then executed in full.
//
// One-sided offers are legal — a gift is a trade where the other side offers
// nothing — but a property with buildings anywhere in its colour group is not
// tradeable, because the buildings would end up on a group their owner no longer
// holds. Sell them back first.

export interface TradeOffer {
  fromId: string;
  toId: string;
  fromTileIds: number[];
  toTileIds: number[];
  fromCash: number;
  toCash: number;
  fromJailCards: number;
  toJailCards: number;
}

export interface TradeCheck {
  ok: boolean;
  reason: string;
}

const ALLOWED: TradeCheck = { ok: true, reason: '' };
const denied = (reason: string): TradeCheck => ({ ok: false, reason });

export function emptyOffer(fromId: string, toId: string): TradeOffer {
  return {
    fromId, toId,
    fromTileIds: [], toTileIds: [],
    fromCash: 0, toCash: 0,
    fromJailCards: 0, toJailCards: 0,
  };
}

/** Flip an offer around, which is all a counter-offer is. */
export function reverseOffer(offer: TradeOffer): TradeOffer {
  return {
    fromId: offer.toId, toId: offer.fromId,
    fromTileIds: [...offer.toTileIds], toTileIds: [...offer.fromTileIds],
    fromCash: offer.toCash, toCash: offer.fromCash,
    fromJailCards: offer.toJailCards, toJailCards: offer.fromJailCards,
  };
}

export function isEmptyOffer(offer: TradeOffer): boolean {
  return offer.fromTileIds.length === 0 && offer.toTileIds.length === 0
      && offer.fromCash === 0 && offer.toCash === 0
      && offer.fromJailCards === 0 && offer.toJailCards === 0;
}

export function validateTrade(board: Board, players: Player[], offer: TradeOffer): TradeCheck {
  const from = players.find((p) => p.id === offer.fromId);
  const to   = players.find((p) => p.id === offer.toId);
  if (!from || !to)        return denied('Both sides of a trade have to be in the game.');
  if (from.id === to.id)   return denied('A player cannot trade with themselves.');
  if (from.isBankrupt || to.isBankrupt) return denied('A bankrupt player cannot trade.');
  if (isEmptyOffer(offer)) return denied('There is nothing in this offer.');

  const sides: Array<[Player, number[], number, number]> = [
    [from, offer.fromTileIds, offer.fromCash, offer.fromJailCards],
    [to,   offer.toTileIds,   offer.toCash,   offer.toJailCards],
  ];

  for (const [player, tileIds, cash, jailCards] of sides) {
    if (cash < 0)                return denied('An offer cannot include negative cash.');
    if (!player.canAfford(cash)) return denied(`${player.name} does not have $${cash}.`);
    if (jailCards < 0)           return denied('An offer cannot include negative cards.');
    if (jailCards > player.getOutOfJailCards) {
      return denied(`${player.name} does not hold that many jail cards.`);
    }

    for (const id of tileIds) {
      const tile = board.getTile(id);
      if (!isOwnable(tile) || tile.ownerId !== player.id) {
        return denied(`${player.name} does not own ${tile.name}.`);
      }
      if (tile instanceof PropertyTile && groupBuildingCount(board, tile) > 0) {
        return denied(`Sell the buildings on ${tile.name}'s colour group before trading it.`);
      }
    }
  }

  return ALLOWED;
}

/**
 * Apply a validated offer. Returns false and changes nothing if it is illegal.
 *
 * `bank` is optional only because a handful of tests trade without one; supply
 * it and mortgaged deeds cost their new owner the 10% the rules charge for
 * taking on the debt.
 */
export function executeTrade(
  board: Board, players: Player[], offer: TradeOffer, bank?: Bank,
): boolean {
  if (!validateTrade(board, players, offer).ok) return false;

  const from = players.find((p) => p.id === offer.fromId)!;
  const to   = players.find((p) => p.id === offer.toId)!;

  const toReceives   = moveTiles(board, offer.fromTileIds, from, to);
  const fromReceives = moveTiles(board, offer.toTileIds,   to,   from);

  // Net the cash so neither side needs to be able to front the gross amount.
  const net = offer.fromCash - offer.toCash;
  if (net > 0) { from.pay(net); to.receive(net); }
  if (net < 0) { to.pay(-net);  from.receive(-net); }

  moveJailCards(from, to, offer.fromJailCards);
  moveJailCards(to, from, offer.toJailCards);

  // After everything has moved and the cash has settled: a player raising money
  // for the interest must not be able to sell something this trade is still in
  // the middle of handing over.
  if (bank) {
    const rate = board.rules.mortgageInterest;
    chargeMortgageInterest(board, bank, to, toReceives, rate);
    chargeMortgageInterest(board, bank, from, fromReceives, rate);
  }
  return true;
}

/** A plain-language summary, for the confirmation line and the toast. */
export function describeOffer(board: Board, players: Player[], offer: TradeOffer): string {
  const from = players.find((p) => p.id === offer.fromId);
  const to   = players.find((p) => p.id === offer.toId);
  const side = (tileIds: number[], cash: number, cards: number): string => {
    const parts = tileIds.map((id) => board.getTile(id).name);
    if (cash > 0)  parts.push(`$${cash}`);
    if (cards > 0) parts.push(`${cards} jail card${cards > 1 ? 's' : ''}`);
    return parts.length ? parts.join(' + ') : 'nothing';
  };
  return `${from?.name ?? '?'} gives ${side(offer.fromTileIds, offer.fromCash, offer.fromJailCards)}` +
         ` for ${side(offer.toTileIds, offer.toCash, offer.toJailCards)}` +
         ` from ${to?.name ?? '?'}`;
}

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Move deeds, and return the mortgaged ones so the receiver can be charged the
 * 10% for taking them on. Both sides of a trade may carry mortgaged deeds, so
 * both sides may owe — the charge happens after *all* the deeds have moved, or a
 * player mortgaging to pay could be selling something the trade is about to take.
 */
function moveTiles(
  board: Board, tileIds: number[], from: Player, to: Player,
): Array<Tile & Ownable> {
  const mortgaged: Array<Tile & Ownable> = [];
  for (const id of tileIds) {
    const tile = board.getTile(id) as Tile & Ownable;
    tile.ownerId = to.id;
    from.ownedTileIds.delete(id);
    to.ownedTileIds.add(id);
    if (tile.isMortgaged) mortgaged.push(tile);
  }
  return mortgaged;
}

function moveJailCards(from: Player, to: Player, count: number): void {
  for (let i = 0; i < count; i++) {
    const card = from.jailCards.pop();
    if (card) to.jailCards.push(card);
  }
}
