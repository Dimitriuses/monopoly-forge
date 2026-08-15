import { bus } from '@/utils/EventBus';
import { Registry } from '@/utils/Registry';
import { walkTo, type LandingContext } from './Landing';
import { settleDebt, announceSettlement } from './Estate';
import type { Player } from './Player';

// ─── Tile effects ─────────────────────────────────────────────────────────────
// What a tile may do when somebody stops on it, *given the game around it*.
//
// `Tile.onLand(playerId)` is handed an id and nothing else, which was enough for
// all ten built-ins: a lot knows its own rent, a tax knows its own amount, and
// everything they cannot work out alone goes on the bus for a driver to resolve.
// It stops being enough the moment a tile's rule mentions somebody *else*.
// "Collect $50 from every other player" cannot be written, because a tile cannot
// see the other players; nor can "auction any unowned property", because a tile
// cannot see the board.
//
// Card effects have had that context since 7c. This is the same idea for tiles,
// and deliberately the same shape — a registry of named handlers, each given a
// small context rather than a driver — so the two extension points are learned
// once. A tile that needs it emits `tile:effect`; both drivers resolve it
// through `applyTileEffect` with the context they already build for a landing,
// which is what keeps the rule in one place rather than one copy per driver.
//
// The division stays where `Landing.ts` put it: what a landing *does* is here,
// and *when the turn ends* is the driver's. An effect that finishes a landing
// says so by emitting `player:landed`, exactly as every built-in tile does.

export interface TileEffectContext extends LandingContext {
  /**
   * Walk a player to a tile and announce the route, so the tokens follow it and
   * every tile passed gets its `onPass`. The landing is resolved by the driver
   * when the walk finishes — an effect must not call `onLand` itself.
   */
  /**
   * Walk somebody to a square. `direct` skips the squares in between — no pay
   * corner passed, no salary collected — which is what the Subway, a travel
   * voucher and the Holland Tunnel all are.
   */
  walkTo(player: Player, tileId: number, options?: { direct?: boolean }): void;
  /** Take money, raising cash and settling a bankruptcy if it comes to that. */
  charge(debtor: Player, creditor: Player | null, amount: number): void;
  /** Pay from the bank. */
  award(player: Player, amount: number): void;
}

export interface TileEffectPayload {
  playerId: string;
  tileId: number;
  /** The registered effect to run. */
  effect: string;
}

export interface TileEffectHandler {
  (ctx: TileEffectContext, player: Player, payload: TileEffectPayload): void;
}

/**
 * The context, built from the one both drivers already assemble for a landing.
 * Built here rather than in each driver on purpose: two implementations of
 * "charge this player" is precisely the drift the shared landing module exists
 * to prevent, and an effect must behave the same animated and headless.
 */
export function effectContext(ctx: LandingContext): TileEffectContext {
  return {
    ...ctx,
    walkTo: (player, tileId, options) => { walkTo(ctx.board, player, tileId, options); },
    charge: (debtor, creditor, amount) => {
      if (amount <= 0) return;
      announceSettlement(debtor, creditor, settleDebt(ctx.board, ctx.bank, debtor, creditor, amount));
    },
    award: (player, amount) => { if (amount > 0) ctx.bank.payPlayer(player, amount); },
  };
}

export const TILE_EFFECTS = new Registry<TileEffectHandler>('tile effects');

/** Teach the engine a tile effect. Registering over a name replaces it. */
export function registerTileEffect(name: string, handler: TileEffectHandler): void {
  TILE_EFFECTS.set(name, handler);
}

export function knownTileEffects(): string[] {
  return TILE_EFFECTS.names();
}

/**
 * Run the effect a tile asked for. Unknown is a warning and a landing that does
 * nothing rather than a throw: a card whose effect this build lacks already
 * degrades that way, and a tile nobody can resolve should not end the game.
 */
export function applyTileEffect(ctx: TileEffectContext, payload: TileEffectPayload): void {
  const handler = TILE_EFFECTS.get(payload.effect);
  const player  = ctx.players.find((p) => p.id === payload.playerId);
  if (!player) return;

  if (!handler) {
    bus.emit('ui:notification', {
      message: `"${payload.effect}" is not a rule this build knows — nothing happens.`,
      type: 'warning',
    });
    bus.emit('player:landed', { playerId: player.id, tileId: payload.tileId });
    return;
  }
  handler(ctx, player, payload);
}
