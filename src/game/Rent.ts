import { PropertyTile } from '@/tiles/PropertyTile';
import { RailroadTile, UtilityTile } from '@/tiles/SpecialTiles';
import type { Tile, TileType } from '@/tiles/Tile';
import { buildingLevel, ownsWholeGroup } from './BuildRules';
import type { Board } from './Board';
import type { Player } from './Player';

// ─── Rent ─────────────────────────────────────────────────────────────────────
// What a tile charges, for the tiles that cannot work it out alone. A railroad's
// rent depends on how many its owner holds, a utility's on the dice, and an
// unimproved lot's on whether its owner has the whole colour group — none of
// which a Tile can see from where it stands. This used to live in GameScene's
// `rent:pay` handler, where it could not be unit-tested.

/** A rate imposed by the card that sent the player here, rather than by the tile. */
export type ArrivalRent = 'railroadDouble' | 'utilityTenTimes';

export interface RentContext {
  /** Last dice total — utilities charge a multiple of it. */
  diceTotal: number;
  /** Rate carried in by a "nearest railroad / utility" card, if any. */
  arrival?: ArrivalRent | null;
  /** Rent the tile already worked out for itself (properties do). */
  declared?: number;
}

export interface RentQuote {
  amount: number;
  /** Human-readable reasons the amount is not the plain tier, for the toast. */
  notes: string[];
}

const BY_CARD = 'sent here by a card';

export function quoteRent(
  board: Board, tile: Tile, creditor: Player, ctx: RentContext,
): RentQuote {
  const notes: string[] = [];

  if (tile instanceof RailroadTile) {
    const base = tile.rentFor(countOwnedOfType(board, creditor, 'railroad'));
    if (ctx.arrival === 'railroadDouble' && base > 0) {
      notes.push(BY_CARD);
      return { amount: base * 2, notes };
    }
    return { amount: base, notes };
  }

  if (tile instanceof UtilityTile) {
    if (tile.isMortgaged) return { amount: 0, notes };
    // Ten times the dice however many the owner holds, when a card sent you.
    const multiplier = ctx.arrival === 'utilityTenTimes'
      ? 10
      : tile.rentMultiplier(countOwnedOfType(board, creditor, 'utility'));
    if (ctx.arrival === 'utilityTenTimes') notes.push(BY_CARD);
    return { amount: multiplier * ctx.diceTotal, notes };
  }

  if (tile instanceof PropertyTile) {
    const base = ctx.declared ?? tile.currentRent;
    // A complete colour group with nothing built on it charges double.
    if (base > 0 && buildingLevel(tile) === 0 && ownsWholeGroup(board, creditor, tile)) {
      notes.push('double — full colour group');
      return { amount: base * 2, notes };
    }
    return { amount: base, notes };
  }

  return { amount: ctx.declared ?? 0, notes };
}

/** How many tiles of one type the player holds — railroads and utilities price
 *  themselves off this, and the property panel shows the tier it reaches. */
export function countOwnedOfType(board: Board, player: Player, type: TileType): number {
  return [...player.ownedTileIds].filter((id) => board.getTile(id).type === type).length;
}
