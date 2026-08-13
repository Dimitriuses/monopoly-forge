import { Tile, type TileDefinition } from './Tile';
import { PropertyTile } from './PropertyTile';
import {
  RailroadTile, UtilityTile, TaxTile, CardTile,
  JailTile, GoToJailTile, GoTile, FreeParkingTile,
} from './SpecialTiles';
import { CLASSIC_RULES, type GameRules } from '@/game/Rules';
import { Registry } from '@/utils/Registry';

// ─── Tile-type registry ───────────────────────────────────────────────────────
// What kinds of tile can exist. `Board`'s constructor used to hold a `switch`
// over the ten built-in types, which meant a game could not add an eleventh
// without editing the engine. A type is a name and a factory now.
//
// `Tile.onLand()` was always the extension point; this is what makes it reachable
// from outside. The built-ins register themselves below, so nothing changes for
// the classic board.

export interface TileFactory {
  (def: TileDefinition, rules: GameRules): Tile;
}

/** Exported so a game's registrations can be scoped to it — see `games/scope.ts`. */
export const TILE_TYPES = new Registry<TileFactory>('tiles');

/**
 * Teach the engine a tile type. Registering over an existing name replaces it,
 * which is how a game re-skins a built-in — say, a `tax` that pays into a pot.
 */
export function registerTileType(type: string, factory: TileFactory): void {
  TILE_TYPES.set(type, factory);
}

export function knownTileTypes(): string[] {
  return TILE_TYPES.names();
}

export function isKnownTileType(type: string): boolean {
  return TILE_TYPES.has(type);
}

/** Build the tile a definition asks for. Throws rather than guess. */
export function createTile(def: TileDefinition, rules: GameRules = CLASSIC_RULES): Tile {
  const factory = TILE_TYPES.get(def.type);
  if (!factory) {
    throw new Error(
      `[tiles] no tile type called "${def.type}" (tile ${def.id} "${def.name}"). ` +
      `Known types: ${knownTileTypes().join(', ')}`,
    );
  }
  return factory(def, rules);
}

// ─── The built-in types ───────────────────────────────────────────────────────

registerTileType('property',       (def) => new PropertyTile(def));
registerTileType('railroad',       (def) => new RailroadTile(def));
registerTileType('utility',        (def) => new UtilityTile(def));
registerTileType('tax',            (def) => new TaxTile(def));
registerTileType('chance',         (def) => new CardTile(def));
registerTileType('communityChest', (def) => new CardTile(def));
registerTileType('jail',           (def) => new JailTile(def));
registerTileType('goToJail',       (def) => new GoToJailTile(def));
registerTileType('freeParking',    (def) => new FreeParkingTile(def));
// The only built-in that needs a rule: what passing it pays.
registerTileType('go',             (def, rules) => new GoTile(def, rules.goSalary));
