import { PropertyTile } from '@/tiles/PropertyTile';
import type { Ownable, Tile } from '@/tiles/Tile';
import type { Board } from './Board';
import type { Bank } from './Bank';
import type { Player } from './Player';

// ─── Build rules ──────────────────────────────────────────────────────────────
// The legality half of development. `Bank` moves cash and inventory and asks no
// questions — deliberately, because it has no view of the board — so the two
// rules that need one live here:
//
//   1. you may only build on a colour group you own outright, and
//   2. houses must stay within one of each other across that group.
//
// Every check returns a reason as well as a verdict, so the property panel can
// say *why* a button is dead instead of just greying it out.

export interface RuleCheck {
  ok: boolean;
  /** Empty when ok — otherwise a sentence fit to show the player. */
  reason: string;
}

const ALLOWED: RuleCheck = { ok: true, reason: '' };
const denied = (reason: string): RuleCheck => ({ ok: false, reason });

/** Buildings standing on a lot, counting a hotel as the fifth. */
export function buildingLevel(tile: PropertyTile): number {
  return tile.hasHotel ? 5 : tile.houses;
}

export function isProperty(tile: Tile): tile is PropertyTile {
  return tile instanceof PropertyTile;
}

/** True when `player` holds every lot in the tile's colour group. */
export function ownsWholeGroup(board: Board, player: Player, tile: PropertyTile): boolean {
  const group = board.groupTiles(tile.group);
  return group.length > 0 && group.every((t) => t.ownerId === player.id);
}

/** Total buildings the player has standing across a colour group. */
export function groupBuildingCount(board: Board, tile: PropertyTile): number {
  return board.groupTiles(tile.group).reduce((n, t) => n + buildingLevel(t), 0);
}

// ─── Building ────────────────────────────────────────────────────────────────

export function canBuildHouse(board: Board, bank: Bank, player: Player, tile: PropertyTile): RuleCheck {
  const base = developable(board, player, tile);
  if (!base.ok) return base;

  if (tile.hasHotel)   return denied(`${tile.name} already has a hotel.`);
  if (tile.houses >= 4) return denied(`${tile.name} is ready for a hotel, not a fifth house.`);

  const lowest = Math.min(...board.groupTiles(tile.group).map(buildingLevel));
  if (buildingLevel(tile) > lowest) {
    return denied('Houses must stay within one of each other across the group.');
  }
  if (bank.houses <= 0)                 return denied('The bank has run out of houses.');
  if (!player.canAfford(tile.houseCost)) return denied(`A house here costs $${tile.houseCost}.`);
  return ALLOWED;
}

export function canBuildHotel(board: Board, bank: Bank, player: Player, tile: PropertyTile): RuleCheck {
  const base = developable(board, player, tile);
  if (!base.ok) return base;

  if (tile.hasHotel)     return denied(`${tile.name} already has a hotel.`);
  if (tile.houses !== 4) return denied('A hotel needs four houses on the lot first.');

  // Even building applies to the hotel too: no lot may be left behind.
  const behind = board.groupTiles(tile.group).some((t) => t.id !== tile.id && buildingLevel(t) < 4);
  if (behind) return denied('Every lot in the group needs four houses first.');

  if (bank.hotels <= 0)                  return denied('The bank has run out of hotels.');
  if (!player.canAfford(tile.houseCost)) return denied(`A hotel here costs $${tile.houseCost}.`);
  return ALLOWED;
}

export function canSellHouse(board: Board, player: Player, tile: PropertyTile): RuleCheck {
  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours to sell from.`);
  if (tile.hasHotel)  return denied('Sell the hotel first.');
  if (tile.houses <= 0) return denied(`${tile.name} has no houses on it.`);

  const highest = Math.max(...board.groupTiles(tile.group).map(buildingLevel));
  if (buildingLevel(tile) < highest) {
    return denied('Houses must come down evenly across the group.');
  }
  return ALLOWED;
}

export function canSellHotel(bank: Bank, player: Player, tile: PropertyTile): RuleCheck {
  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours to sell from.`);
  if (!tile.hasHotel) return denied(`${tile.name} has no hotel on it.`);
  // A hotel comes down into four houses; without the stock to hand back, the
  // sale would silently destroy them (Bank.sellHotel leaves the lot bare).
  if (bank.houses < 4) return denied('The bank has too few houses to break the hotel into.');
  return ALLOWED;
}

// ─── Mortgaging ───────────────────────────────────────────────────────────────

export function canMortgage(board: Board, player: Player, tile: Tile & Ownable): RuleCheck {
  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours.`);
  if (tile.isMortgaged)           return denied(`${tile.name} is already mortgaged.`);
  if (isProperty(tile) && groupBuildingCount(board, tile) > 0) {
    return denied('Sell the buildings on this colour group first.');
  }
  return ALLOWED;
}

export function canUnmortgage(player: Player, tile: Ownable): RuleCheck {
  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours.`);
  if (!tile.isMortgaged)          return denied(`${tile.name} is not mortgaged.`);
  const cost = unmortgageCost(tile);
  if (!player.canAfford(cost))    return denied(`Lifting the mortgage costs $${cost}.`);
  return ALLOWED;
}

/** 110% of the mortgage value, matching Bank.unmortgage. */
export function unmortgageCost(tile: Ownable): number {
  return Math.floor(tile.mortgage * 1.1);
}

// ─── Shared preconditions ─────────────────────────────────────────────────────

/** Ownership, monopoly and mortgage checks common to houses and hotels. */
function developable(board: Board, player: Player, tile: PropertyTile): RuleCheck {
  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours to build on.`);
  if (!ownsWholeGroup(board, player, tile)) {
    return denied('You must own every lot in the colour group to build.');
  }
  if (board.groupTiles(tile.group).some((t) => t.isMortgaged)) {
    return denied('Nothing can be built while a lot in the group is mortgaged.');
  }
  return ALLOWED;
}
