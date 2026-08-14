import type { GameMap } from '@/maps';
import type { TileDefinition, TileType } from '@/tiles/Tile';
import type { Card } from '@/cards/CardDeck';

// ─── Compose ──────────────────────────────────────────────────────────────────
// Making a game out of one that already exists.
//
// `GameRules` has always layered — classic, then the game's, then the player's —
// so *overriding* a number was never the problem. What could not be said was
// **subtraction**: a board like the classic one but with no utilities, or the
// classic deck minus the three cards that name one.
//
// Two helpers, and one rule that shapes both: **a derived board keeps its length
// and its ids.** Removing a tile would renumber everything after it and quietly
// break every card that names a square, so `deriveMap` *replaces* rather than
// removes. "No utilities" is a board where each utility is something else, not a
// board that is two tiles shorter.
//
// The two are deliberately separate, because the interesting thing is that they
// have to be used together. Swap the utilities out and `validateGame` will refuse
// the classic deck — it has a card that advances to the nearest utility, and
// there are none. The engine makes you trim the deck; it does not let you ship a
// board whose own cards cannot resolve.

/**
 * A board like another one, tile for tile. `swap` sees every tile and returns
 * what it should be — itself, or something else of the same id.
 *
 * The id is forced back on afterwards, so a transform that forgets to carry it
 * cannot silently break the circuit.
 */
export function deriveMap(
  from: GameMap,
  over: {
    id: string;
    name: string;
    blurb?: string;
    layout?: GameMap['layout'];
    swap?: (tile: TileDefinition, index: number) => TileDefinition;
  },
): GameMap {
  const swap = over.swap ?? ((tile) => tile);
  return {
    id:     over.id,
    name:   over.name,
    blurb:  over.blurb ?? from.blurb,
    layout: over.layout ?? from.layout,
    tiles:  from.tiles.map((tile, index) => ({ ...swap(tile, index), id: index })),
  };
}

/**
 * Every tile of these types becomes something else. The commonest derivation
 * there is — "the classic board, but the utilities are Chance squares" — and the
 * one that shows why `deriveMap` replaces rather than removes.
 *
 * `becomes` gets the tile it is replacing, so it can keep the name or the price
 * if it wants to.
 */
export function replacingTypes(
  types: TileType[], becomes: (tile: TileDefinition) => TileDefinition,
): (tile: TileDefinition) => TileDefinition {
  const wanted = new Set(types);
  return (tile) => (wanted.has(tile.type) ? becomes(tile) : tile);
}

/**
 * A deck minus the cards you do not want, by id. Refuses an id the deck does not
 * have: a typo that silently removes nothing is worse than one that stops the
 * build, and the whole point of trimming a deck is knowing what came out.
 */
export function withoutCards(cards: Card[], ...ids: string[]): Card[] {
  const missing = ids.filter((id) => !cards.some((card) => card.id === id));
  if (missing.length) {
    throw new Error(
      `[compose] this deck has no card called ${missing.join(', ')} — ` +
      `it has ${cards.map((c) => c.id).join(', ')}`,
    );
  }
  const drop = new Set(ids);
  return cards.filter((card) => !drop.has(card.id));
}

/**
 * A deck minus every card whose effect names a *place* — a tile index, or the
 * nearest tile of a type the board may not have. What is left travels to any
 * board, which is the property the alternative games' hand-written decks were
 * written to have.
 */
export function portableCards(cards: Card[]): Card[] {
  return cards.filter((card) => {
    const action = card.action as { type: string };
    return action.type !== 'advanceTo' && action.type !== 'advanceToNearest';
  });
}
