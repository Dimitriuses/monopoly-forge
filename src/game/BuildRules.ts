import { PropertyTile } from '@/tiles/PropertyTile';
import { isOwnable, type Ownable, type Tile } from '@/tiles/Tile';
import { consumedBy, costOf, rungAt, topLevel } from './BuildLadder';
import type { Board } from './Board';
import type { Bank } from './Bank';
import type { Player } from './Player';
import { CLASSIC_RULES } from './Rules';

// ─── Build rules ──────────────────────────────────────────────────────────────
// The legality half of development. `Bank` moves cash and inventory and asks no
// questions — deliberately, because it has no view of the board — so the rules
// that need one live here:
//
//   1. you may only build on a colour group you own outright,
//   2. buildings must stay within one of each other across that group, and
//   3. neither applies to a level that says `group: false` — a train depot needs
//      nothing but the deed it stands on.
//
// Since M12d this is one check per *direction* rather than one per building:
// `canBuild` and `canSell` walk the ladder, so a game adding a rung above the
// hotel gets its legality for free. Every check returns a reason as well as a
// verdict, so the property panel can say *why* a button is dead.

export interface RuleCheck {
  ok: boolean;
  /** Empty when ok — otherwise a sentence fit to show the player. */
  reason: string;
}

const ALLOWED: RuleCheck = { ok: true, reason: '' };
const denied = (reason: string): RuleCheck => ({ ok: false, reason });

/** Which rung is standing on a tile — 0 for anything that cannot hold one. */
export function buildingLevel(tile: Tile): number {
  return isOwnable(tile) ? tile.level : 0;
}

export function isProperty(tile: Tile): tile is PropertyTile {
  return tile instanceof PropertyTile;
}

/** True when `player` holds every lot in the tile's colour group. */
export function ownsWholeGroup(board: Board, player: Player, tile: PropertyTile): boolean {
  const group = board.groupTiles(tile.group);
  return group.length > 0 && group.every((t) => t.ownerId === player.id);
}

/**
 * True when `player` holds all but one of a colour group of more than two.
 *
 * Ultimate Monopoly's **majority ownership**, and it is the *building* half of a
 * rule whose renting half has been in `game/Rent.ts` since M11 (`majorityRent`).
 * A group of two is excluded by the printed rule and by arithmetic alike: all
 * but one of two is one lot, which is not ownership of anything.
 */
export function ownsMajority(board: Board, player: Player, tile: PropertyTile): boolean {
  const group = board.groupTiles(tile.group);
  if (group.length <= 2) return false;
  return group.filter((t) => t.ownerId === player.id).length === group.length - 1;
}

/** The lots of this tile's group that the player actually holds. */
function ownedInGroup(board: Board, player: Player, tile: PropertyTile): PropertyTile[] {
  return board.groupTiles(tile.group).filter((t) => t.ownerId === player.id);
}

/** Total buildings the player has standing across a colour group. */
export function groupBuildingCount(board: Board, tile: PropertyTile): number {
  return board.groupTiles(tile.group).reduce((n, t) => n + buildingLevel(t), 0);
}

// ─── Building ────────────────────────────────────────────────────────────────

/**
 * May this tile climb one rung? The one question, whatever the rung is.
 *
 * A level that needs its colour group brings the two rules that come with one —
 * own it outright, and keep the group even. A level that does not (a train
 * depot) skips both, which is the printed rule: "you don't need to own multiple
 * Railroads before building a Train Depot on one."
 */
export function canBuild(board: Board, bank: Bank, player: Player, tile: Tile & Ownable): RuleCheck {
  const next = tile.level + 1;
  const rung = rungAt(board.rules.buildLadder, tile.type, next);
  if (!rung) {
    const top = topLevel(board.rules.buildLadder, tile.type);
    return denied(top === 0
      ? `Nothing can be built on ${tile.name}.`
      : `${tile.name} is built as far as it goes.`);
  }
  const { kind } = rung;

  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours to build on.`);
  if (tile.isMortgaged)           return denied(`${tile.name} is mortgaged.`);

  if (kind.group) {
    if (!isProperty(tile)) return denied(`${tile.name} is not in a colour group.`);
    const shared = developable(board, player, tile, kind.group);
    if (!shared.ok) return shared;

    // Even building, and it is the *level* that has to stay even rather than the
    // house count: a group where one lot has a hotel and another has three
    // houses is uneven whether or not you call five "a hotel".
    //
    // Measured over the lots this player **owns**. On a full group that is every
    // lot and nothing changes; on a majority the one you do not own sits at
    // level 0 for ever, and counting it would forbid the first house.
    const mine = ownedInGroup(board, player, tile);
    const lowest = Math.min(...mine.map(buildingLevel));
    if (tile.level > lowest) {
      return denied(`${kind.label}s must go up evenly across the colour group.`);
    }
  }

  if ((bank.stock[kind.id] ?? 0) <= 0) {
    return denied(`The bank has run out of ${kind.label.toLowerCase()}s.`);
  }
  const cost = costOf(kind, houseCostOf(tile));
  if (!player.canAfford(cost)) return denied(`A ${kind.label.toLowerCase()} here costs $${cost}.`);
  return ALLOWED;
}

/**
 * May this tile come down one rung?
 *
 * The one thing a sale can get wrong is the exchange underneath it: a hotel
 * comes down into four houses, and if the bank has not got four the sale would
 * silently destroy them.
 */
export function canSell(board: Board, bank: Bank, player: Player, tile: Tile & Ownable): RuleCheck {
  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours to sell from.`);
  const rung = rungAt(board.rules.buildLadder, tile.type, tile.level);
  if (!rung) return denied(`${tile.name} has nothing on it to sell.`);

  if (rung.kind.group && isProperty(tile)) {
    const highest = Math.max(...ownedInGroup(board, player, tile).map(buildingLevel));
    if (tile.level < highest) {
      return denied('Buildings must come down evenly across the colour group.');
    }
  }

  const needed = consumedBy(board.rules.buildLadder, tile.type, tile.level - 1);
  if (needed && (bank.stock[needed.kind.id] ?? 0) < needed.count) {
    return denied(`The bank has too few ${needed.kind.label.toLowerCase()}s to break it into.`);
  }
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

/** `rate` is `board.rules.mortgageInterest`; the default is the classic 10%. */
export function canUnmortgage(
  player: Player, tile: Ownable, rate = CLASSIC_RULES.mortgageInterest,
): RuleCheck {
  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours.`);
  if (!tile.isMortgaged)          return denied(`${tile.name} is not mortgaged.`);
  const cost = unmortgageCost(tile, rate);
  if (!player.canAfford(cost))    return denied(`Lifting the mortgage costs $${cost}.`);
  return ALLOWED;
}

/**
 * The mortgage back, plus interest — the *second* of the two charges the printed
 * rules make. The rate is a rule value rather than a literal `1.1`, so the one
 * number governs both halves: a game that turns interest off turns off the
 * transfer fee and this together.
 */
export function unmortgageCost(tile: Ownable, rate = CLASSIC_RULES.mortgageInterest): number {
  return Math.floor(tile.mortgage * (1 + rate));
}

// ─── Shared preconditions ─────────────────────────────────────────────────────

/** What a level with no price of its own charges here. */
function houseCostOf(tile: Tile & Ownable): number {
  return (tile as { houseCost?: number }).houseCost ?? 0;
}

/** Ownership and mortgage checks common to every group-built level. */
function developable(
  board: Board, player: Player, tile: PropertyTile, needs: 'group' | 'majority',
): RuleCheck {
  if (tile.ownerId !== player.id) return denied(`${tile.name} is not yours to build on.`);

  const whole = ownsWholeGroup(board, player, tile);
  if (needs === 'group' && !whole) {
    return denied('You must own every lot in the colour group to build.');
  }
  if (needs === 'majority' && !whole && !ownsMajority(board, player, tile)) {
    return denied('You must own all but one lot in the colour group to build.');
  }

  // Only the lots you hold. Somebody else's mortgage is their business, and on a
  // majority it is not even a lot you could unmortgage.
  if (ownedInGroup(board, player, tile).some((t) => t.isMortgaged)) {
    return denied('Nothing can be built while a lot you own in the group is mortgaged.');
  }
  return ALLOWED;
}
