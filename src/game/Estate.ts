import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable, type Ownable, type Tile } from '@/tiles/Tile';
import { bus } from '@/utils/EventBus';
import { buildingLevel, canSellHotel, canSellHouse, canMortgage } from './BuildRules';
import type { Board } from './Board';
import type { Bank } from './Bank';
import type { Player } from './Player';

// ─── Estate ───────────────────────────────────────────────────────────────────
// What happens when a player cannot pay. The old behaviour was to clamp their
// cash at zero and flag them bankrupt, which meant a player never really owed
// anything and their properties stayed theirs — still charging rent — after they
// left the game.
//
// A debt is now settled in three stages:
//
//   1. pay from cash;
//   2. if that is short, raise the rest by selling buildings and mortgaging;
//   3. if it is *still* short, the player is bankrupt: everything they hold goes
//      to the creditor (or back to the bank), and they are out.
//
// Stage 2 goes through Bank and BuildRules rather than writing to tiles directly,
// so the house stock and the even-selling rule stay honest during a fire sale.

export interface Settlement {
  /** What actually reached the creditor. */
  paid: number;
  /** What could not be raised — non-zero only when the player went bankrupt. */
  shortfall: number;
  bankrupt: boolean;
  /** Human-readable trail of the fire sale, for the debug log. */
  actions: string[];
  /** Counts for the toast, which has room for a summary but not a list. */
  sold: number;
  mortgaged: number;
  /**
   * Deeds that went back to the bank unowned, because there was no creditor.
   * The standard rules have the bank auction each of them, and it cannot do
   * that without being told which — the tiles are already unowned by the time
   * anybody hears about the bankruptcy.
   */
  returned: number[];
}

export interface Liquidation {
  actions: string[];
  sold: number;
  mortgaged: number;
}

/** Everything the player could turn into cash right now, plus the cash itself. */
export function liquidValue(board: Board, player: Player): number {
  let total = player.cash;
  for (const tile of ownedTiles(board, player)) {
    if (tile instanceof PropertyTile) {
      total += tile.houses * Math.floor(tile.houseCost / 2);
      if (tile.hasHotel) total += Math.floor(tile.houseCost / 2);
    }
    if (!tile.isMortgaged) total += tile.mortgage;
  }
  return total;
}

/**
 * Sell buildings and mortgage property until the player holds `target` in cash.
 * Buildings go first, tallest lot first — which is also what the even-selling
 * rule demands — then property by mortgage value, largest first, so the fewest
 * possible deeds are turned over.
 */
export function raiseCash(
  board: Board, bank: Bank, player: Player, target: number,
): Liquidation {
  const actions: string[] = [];
  let sold = 0;
  let mortgaged = 0;

  while (player.cash < target) {
    // Tallest first, skipping any the rules will not let go right now — a hotel
    // the bank cannot break into houses must not stop the rest of the sale.
    const lot = developedLots(board, player).find((l) => (
      l.hasHotel ? canSellHotel(bank, player, l).ok : canSellHouse(board, player, l).ok
    ));
    if (!lot) break;

    const wasHotel = lot.hasHotel;
    if (!(wasHotel ? bank.sellHotel(player, lot) : bank.sellHouse(player, lot))) break;
    actions.push(`sold ${wasHotel ? 'the hotel' : 'a house'} on ${lot.name}`);
    sold++;
  }

  const mortgageable = ownedTiles(board, player)
    .filter((t) => !t.isMortgaged)
    .sort((a, b) => b.mortgage - a.mortgage);

  for (const tile of mortgageable) {
    if (player.cash >= target) break;
    if (!canMortgage(board, player, tile).ok) continue;
    if (bank.mortgage(player, tile)) {
      actions.push(`mortgaged ${tile.name} for $${tile.mortgage}`);
      mortgaged++;
    }
  }

  return { actions, sold, mortgaged };
}

/**
 * Pay `amount` from `debtor` to `creditor` (or to the bank when null), raising
 * cash by force if need be and declaring bankruptcy if that is not enough.
 */
export function settleDebt(
  board: Board, bank: Bank, debtor: Player, creditor: Player | null, amount: number,
): Settlement {
  const actions: string[] = [];
  let sold = 0;
  let mortgaged = 0;

  if (debtor.cash < amount) {
    const raised = raiseCash(board, bank, debtor, amount);
    actions.push(...raised.actions);
    sold = raised.sold;
    mortgaged = raised.mortgaged;
  }

  if (debtor.cash >= amount) {
    debtor.pay(amount);
    creditor?.receive(amount);
    return { paid: amount, shortfall: 0, bankrupt: false, actions, sold, mortgaged, returned: [] };
  }

  // Everything they have left, and then they are out of the game.
  const paid = debtor.cash;
  debtor.pay(paid);
  creditor?.receive(paid);
  const shortfall = amount - paid;

  const transfer = transferEstate(board, bank, debtor, creditor);
  actions.push(...transfer.actions);
  debtor.isBankrupt = true;

  return {
    paid, shortfall, bankrupt: true, actions, sold, mortgaged,
    returned: transfer.returned,
  };
}

/**
 * What a player owes for *receiving* mortgaged deeds — the 10% the printed rules
 * charge the moment a mortgaged property changes hands, whether by trade, by
 * auction or out of a bankrupt estate.
 *
 * Written once and called from all three, because until M10a none of them
 * charged it: the deeds moved still mortgaged and the new owner inherited the
 * debt for nothing. All three agreed with each other, which is exactly why it
 * never looked wrong, and none agreed with the rules.
 *
 * The *second* charge — 10% again when the mortgage is actually lifted — has
 * always been in `BuildRules.unmortgageCost`, so this is the half that was
 * missing rather than the whole rule.
 */
export function mortgageTransferFee(tiles: Array<Tile & Ownable>, rate: number): number {
  if (rate <= 0) return 0;
  return tiles
    .filter((tile) => tile.isMortgaged)
    .reduce((owed, tile) => owed + Math.round(tile.mortgage * rate), 0);
}

/**
 * Charge it, through `settleDebt` like every other charge — a player who cannot
 * cover the interest on an estate they have just inherited sells, mortgages and
 * if necessary goes under, which is the same chain everything else uses. Never
 * `player.pay`, which clamps at zero and would make the debt vanish.
 */
export function chargeMortgageInterest(
  board: Board, bank: Bank, player: Player, tiles: Array<Tile & Ownable>, rate: number,
): number {
  const owed = mortgageTransferFee(tiles, rate);
  if (owed <= 0) return 0;
  const settlement = settleDebt(board, bank, player, null, owed);
  announceSettlement(player, null, settlement);
  bus.emit('ui:notification', {
    message: `${player.name} paid $${owed} interest on mortgaged deeds.`,
    type: 'warning',
  });
  return owed;
}

/**
 * Hand a bankrupt player's holdings to their creditor, or back to the bank when
 * there isn't one. Mortgaged deeds stay mortgaged — the new owner inherits the
 * debt, and now also the 10% interest the rules charge for taking it on.
 */
export function transferEstate(
  board: Board, bank: Bank, debtor: Player, creditor: Player | null,
): { actions: string[]; returned: number[] } {
  const actions: string[] = [];
  const tiles = ownedTiles(board, debtor);

  for (const tile of tiles) {
    // A creditor inherits land, not houses. Usually the fire sale has already
    // cleared them; anything left (a hotel the bank could not break up) goes
    // back to stock rather than out of the game — the house supply is fixed.
    if (tile instanceof PropertyTile && buildingLevel(tile) > 0) {
      bank.houses += tile.houses;
      if (tile.hasHotel) bank.hotels += 1;
      tile.houses = 0;
      tile.hasHotel = false;
    }
    tile.ownerId = creditor?.id ?? null;
    creditor?.ownedTileIds.add(tile.id);
  }
  debtor.ownedTileIds.clear();

  if (tiles.length) {
    actions.push(
      creditor
        ? `${tiles.length} deed(s) passed to ${creditor.name}`
        : `${tiles.length} deed(s) returned to the bank`,
    );
  }

  // Interest on whatever came over mortgaged. Charged *after* the deeds have
  // moved, so a creditor who cannot cover it can mortgage the very estate they
  // have just inherited — which is what `settleDebt` will reach for, and what
  // the printed rules leave you to do.
  if (creditor) {
    const owed = chargeMortgageInterest(
      board, bank, creditor,
      tiles.filter((t) => t.isMortgaged), board.rules.mortgageInterest,
    );
    if (owed > 0) actions.push(`${creditor.name} paid $${owed} mortgage interest`);
  }

  if (debtor.jailCards.length) {
    const cards = debtor.jailCards;
    debtor.jailCards = [];

    if (creditor) {
      creditor.jailCards.push(...cards);
    } else {
      // They used to be *lost* here, which the simulator's deck census caught on
      // its first batch: "15 cards accounted for, 16 were dealt". A card that
      // leaves the game shortens the deck for the rest of it, and enough
      // bankruptcies would empty one. Whoever holds the decks puts them back.
      bus.emit('card:return', { cards });
    }
    actions.push(creditor
      ? `${cards.length} Get Out of Jail Free card(s) passed to ${creditor.name}`
      : `${cards.length} Get Out of Jail Free card(s) returned to the deck`);
  }

  // Only when there is no creditor: with one, the deeds have an owner already
  // and there is nothing for the bank to sell.
  return { actions, returned: creditor ? [] : tiles.map((t) => t.id) };
}

/**
 * Tell the table what a settlement cost. Kept next to the rules so every caller
 * — rent, tax and cards alike — reports a fire sale and a bankruptcy the same
 * way, instead of each scene handler inventing its own wording.
 */
export function announceSettlement(
  debtor: Player, creditor: Player | null, settlement: Settlement,
): void {
  // A summary, not the list: a toast is 320px wide and stacks on its neighbours.
  // The itemised trail is in `actions` for the debug log.
  const raised: string[] = [];
  if (settlement.sold)      raised.push(`sold ${plural(settlement.sold, 'building')}`);
  if (settlement.mortgaged) raised.push(`mortgaged ${plural(settlement.mortgaged, 'deed')}`);
  if (raised.length) {
    bus.emit('ui:notification', {
      message: `${debtor.name} raised cash — ${raised.join(', ')}.`,
      type: 'warning',
    });
  }
  if (settlement.bankrupt) {
    bus.emit('ui:notification', {
      message: `${debtor.name} is bankrupt! 💀 ` +
               (creditor ? `Their estate passes to ${creditor.name}.` : 'Their estate returns to the bank.'),
      type: 'danger',
    });
    bus.emit('player:bankrupt', {
      playerId:   debtor.id,
      creditorId: creditor?.id ?? null,
      // What the bank now holds unowned, so it can put each one under the hammer.
      returned:   settlement.returned,
    });
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function ownedTiles(board: Board, player: Player): Array<Tile & Ownable> {
  return [...player.ownedTileIds]
    .map((id) => board.getTile(id))
    .filter((t): t is Tile & Ownable => isOwnable(t) && t.ownerId === player.id);
}

/** Built-on lots, tallest first — selling from the top keeps a group even. */
function developedLots(board: Board, player: Player): PropertyTile[] {
  return ownedTiles(board, player)
    .filter((t): t is PropertyTile => t instanceof PropertyTile && buildingLevel(t) > 0)
    .sort((a, b) => buildingLevel(b) - buildingLevel(a));
}
