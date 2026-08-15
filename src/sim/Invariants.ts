import { PropertyTile } from '@/tiles/PropertyTile';
import { heldByPlayer, holdingKind, knownHoldings } from '@/game/Holdings';
import { isOwnable } from '@/tiles/Tile';
import type { Board } from '@/game/Board';
import type { Bank } from '@/game/Bank';
import type { Player } from '@/game/Player';
import type { GameRules } from '@/game/Rules';
import type { CardDeck } from '@/cards/CardDeck';

// ─── Invariants ───────────────────────────────────────────────────────────────
// What has to be true after every turn of every game, whatever the rules say.
//
// A rule bug that shows up once in five hundred games is invisible at the table
// and obvious across a batch — but only if somebody wrote down what "wrong"
// means. These are those statements.
//
// **Cash is deliberately not one of them.** The roadmap called for "total cash
// conserved", and that is simply not true of Monopoly: the bank has unlimited
// money, the GO salary and half the Chance deck *create* it, and taxes destroy
// it. An invariant that does not hold is worse than no invariant, so what is
// checked instead is that nobody holds a negative amount and that every
// *countable* thing — cards, houses, hotels, deeds — is somewhere it belongs.

export interface Violation {
  what: string;
  detail: string;
}

export interface InvariantContext {
  board: Board;
  bank: Bank;
  players: Player[];
  rules: GameRules;
  decks: CardDeck[];
}

export function checkInvariants(ctx: InvariantContext): Violation[] {
  return [
    ...positionsOnBoard(ctx),
    ...cashIsSane(ctx),
    ...deedsAgree(ctx),
    ...buildingCensus(ctx),
    ...deckCensus(ctx),
    ...bankruptcyIsFinal(ctx),
    ...holdingsAreSane(ctx),
  ];
}

/** Nobody stands off the end of the circuit. */
function positionsOnBoard({ board, players }: InvariantContext): Violation[] {
  return players
    .filter((p) => !Number.isInteger(p.position) || p.position < 0 || p.position >= board.size)
    .map((p) => ({
      what: 'position',
      detail: `${p.id} is on tile ${p.position} of a ${board.size}-tile board`,
    }));
}

/** `Player.pay` clamps at zero, so a negative balance means somebody wrote one. */
function cashIsSane({ players }: InvariantContext): Violation[] {
  return players
    .filter((p) => !Number.isFinite(p.cash) || p.cash < 0)
    .map((p) => ({ what: 'cash', detail: `${p.id} holds ${p.cash}` }));
}

/**
 * Ownership is recorded twice — on the tile and in the player's set — and the
 * two must agree. A trade, an auction, a bankruptcy and a fire sale all move a
 * deed, and each of them is a place the pair could drift apart.
 */
function deedsAgree({ board, players }: InvariantContext): Violation[] {
  const problems: Violation[] = [];
  const byId = new Map(players.map((p) => [p.id, p]));

  for (const tile of board.tiles) {
    if (!isOwnable(tile)) continue;
    if (tile.ownerId === null) {
      const claimant = players.find((p) => p.ownedTileIds.has(tile.id));
      if (claimant) {
        problems.push({
          what: 'deeds',
          detail: `tile ${tile.id} is unowned but ${claimant.id} still lists it`,
        });
      }
      continue;
    }
    const owner = byId.get(tile.ownerId);
    if (!owner) {
      problems.push({ what: 'deeds', detail: `tile ${tile.id} is owned by "${tile.ownerId}", who is not at the table` });
    } else if (!owner.ownedTileIds.has(tile.id)) {
      problems.push({ what: 'deeds', detail: `tile ${tile.id} says ${owner.id} owns it; ${owner.id} disagrees` });
    }
  }

  for (const player of players) {
    for (const id of player.ownedTileIds) {
      const tile = board.getTile(id);
      if (!isOwnable(tile) || tile.ownerId !== player.id) {
        problems.push({ what: 'deeds', detail: `${player.id} lists tile ${id}, which says otherwise` });
      }
    }
  }
  return problems;
}

/**
 * The building supply is finite and that is a rule, not an accident: houses in
 * the bank plus houses on the board must equal what the rule set stocked. A
 * hotel is worth `housesPerHotel` of them, which is why breaking one up has its
 * own check in `BuildRules`.
 */
function buildingCensus({ board, bank, rules }: InvariantContext): Violation[] {
  const lots = board.tiles.filter((t): t is PropertyTile => t instanceof PropertyTile);
  const problems: Violation[] = [];

  const housesOut = lots.reduce((n, lot) => n + lot.houses, 0);
  if (housesOut + bank.houses !== rules.houseLimit) {
    problems.push({
      what: 'houses',
      detail: `${housesOut} on the board + ${bank.houses} in the bank ≠ ${rules.houseLimit}`,
    });
  }

  const hotelsOut = lots.filter((lot) => lot.hasHotel).length;
  if (hotelsOut + bank.hotels !== rules.hotelLimit) {
    problems.push({
      what: 'hotels',
      detail: `${hotelsOut} on the board + ${bank.hotels} in the bank ≠ ${rules.hotelLimit}`,
    });
  }

  // A lot cannot be both fully built and building.
  for (const lot of lots) {
    if (lot.hasHotel && lot.houses > 0) {
      problems.push({ what: 'buildings', detail: `${lot.name} has a hotel and ${lot.houses} houses` });
    }
    if (lot.houses > bank.housesPerHotel) {
      problems.push({ what: 'buildings', detail: `${lot.name} has ${lot.houses} houses` });
    }
  }
  return problems;
}

/**
 * Every card is in exactly one place: the draw pile, the discard, or somebody's
 * hand. A card returned twice, or never, is what drains a deck over a long game
 * — and a drained deck is the failure this project has already had once.
 */
function deckCensus({ decks, players }: InvariantContext): Violation[] {
  const problems: Violation[] = [];
  const held = players.flatMap((p) => p.jailCards.map((c) => c.id));

  for (const deck of decks) {
    const snapshot = deck.snapshot();
    const seen = [...snapshot.draw, ...snapshot.discard, ...held.filter((id) => deck.ownsId(id))];
    const unique = new Set(seen);

    if (unique.size !== seen.length) {
      problems.push({ what: 'deck', detail: `a card is in two places at once (${seen.length} slots, ${unique.size} cards)` });
    }
    if (unique.size !== deck.size) {
      problems.push({
        what: 'deck',
        detail: `${unique.size} cards accounted for, ${deck.size} were dealt`,
      });
    }
  }
  return problems;
}

/** A bankrupt player holds nothing — that is what bankrupt means. */
function bankruptcyIsFinal({ players }: InvariantContext): Violation[] {
  return players
    .filter((p) => p.isBankrupt
      && (p.ownedTileIds.size > 0 || p.jailCards.length > 0 || heldByPlayer(p).length > 0))
    .map((p) => ({
      what: 'bankruptcy',
      detail: `${p.id} is bankrupt but holds ${p.ownedTileIds.size} deed(s), `
            + `${p.jailCards.length} card(s) and ${heldByPlayer(p).length} kind(s) of holding`,
    }));
}

/**
 * Every holding is a kind this build registered, and no count is negative or
 * over its limit.
 *
 * A census rather than a conservation law, deliberately: a game *mints* travel
 * vouchers and spends them, so the total is not fixed and checking that it were
 * would be checking something untrue — the mistake the M8d roadmap made about
 * total cash.
 */
function holdingsAreSane({ players }: InvariantContext): Violation[] {
  const problems: Violation[] = [];
  const known = new Set(knownHoldings());

  for (const player of players) {
    for (const [name, count] of Object.entries(player.holdings)) {
      if (!known.has(name)) {
        problems.push({ what: 'holdings', detail: `${player.id} holds unregistered "${name}"` });
        continue;
      }
      if (!Number.isInteger(count) || count < 0) {
        problems.push({ what: 'holdings', detail: `${player.id} holds ${count} × ${name}` });
      }
      const limit = holdingKind(name)?.limit;
      if (limit !== undefined && count > limit) {
        problems.push({
          what: 'holdings',
          detail: `${player.id} holds ${count} × ${name}, over the limit of ${limit}`,
        });
      }
    }
  }
  return problems;
}
