import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';
import { Tile, isOwnable, type TileDefinition } from '@/tiles/Tile';
import { RailroadTile, UtilityTile } from '@/tiles/SpecialTiles';
import { registerTileType } from '@/tiles/registry';
import { registerTileEffect } from '@/game/TileEffects';
import { TUNNELS } from './board';

// ─── Ultimate Monopoly's tiles ────────────────────────────────────────────────
// Everything the classic board has no word for. Two kinds of thing live here and
// the split is the interesting part:
//
//   * **Tiles that know their own rule** — a cab company knows its rent ladder, a
//     pay corner knows what it pays. These are `registerTileType`, and they need
//     nothing but `onLand` / `onPass`.
//   * **Tiles whose rule mentions somebody else** — "collect $50 from every other
//     player", "auction any unowned property", "take half the pool". A tile
//     cannot see the other players or the board, so these emit `tile:effect` and
//     the rule is a `registerTileEffect` handler with the landing context. See
//     `game/TileEffects.ts`; that extension point exists because of this board.
//
// Everything registered here goes through `Game.register`, so it is in force
// only while this game is loaded and cannot leak into the next one.

/** A tile whose whole job is to ask for a rule with a wider view than its own. */
class EffectTile extends Tile {
  constructor(def: TileDefinition, private readonly effect: string) { super(def); }

  onLand(playerId: string): void {
    bus.emit('tile:effect', { playerId, tileId: this.id, effect: this.effect });
  }
}

/** Money from the bank, on the same channel the GO salary uses. */
function payFromBank(playerId: string, tileId: number, amount: number): void {
  bus.emit('rent:pay', {
    debtorId: 'bank', creditorId: playerId, amount, tileId, reason: 'go',
  });
}

// ─── Things that charge rent ──────────────────────────────────────────────────

/**
 * A cab company is a railroad that counts its own kind. It extends `RailroadTile`
 * so `quoteRent` recognises it without being taught, and `quoteRent` counts by
 * `tile.type` — so holding four cabs raises the cab rate and leaves the railroads
 * alone.
 */
class CabCompanyTile extends RailroadTile {
  static readonly RENT = [30, 60, 120, 240];
  override rentFor(ownedCount: number): number {
    if (this.isMortgaged) return 0;
    return CabCompanyTile.RENT[Math.min(ownedCount, 4) - 1] ?? CabCompanyTile.RENT[0];
  }
}

/**
 * Eight utilities, not two, so the ladder is eight rungs. Registered *over* the
 * built-in `utility`, which is what the tile registry is for: a game re-skins a
 * built-in by name rather than the engine growing a switch.
 */
class LadderUtilityTile extends UtilityTile {
  static readonly LADDER = [4, 10, 20, 40, 80, 100, 120, 150];
  override rentMultiplier(ownedCount: number): number {
    const rung = Math.min(Math.max(ownedCount, 1), LadderUtilityTile.LADDER.length);
    return LadderUtilityTile.LADDER[rung - 1];
  }
}

// ─── Pay corners ──────────────────────────────────────────────────────────────
// Three corners pay a salary, on three different tracks, and they are the reason
// `onPass` fires for the landing tile too. `onPass` is what a tile charges for
// being there at all; `onLand` is the *extra* for stopping. Write the landing
// amount in `onLand` instead and every pass would pay twice.

class PayDayTile extends Tile {
  static readonly PASSING = 300;
  static readonly LANDING = 400;

  override onPass(playerId: string): void {
    payFromBank(playerId, this.id, PayDayTile.PASSING);
  }

  onLand(playerId: string): void {
    payFromBank(playerId, this.id, PayDayTile.LANDING - PayDayTile.PASSING);
    bus.emit('player:landed', { playerId, tileId: this.id });
  }
}

class BonusTile extends Tile {
  static readonly PASSING = 250;
  static readonly LANDING = 300;

  override onPass(playerId: string): void {
    payFromBank(playerId, this.id, BonusTile.PASSING);
  }

  onLand(playerId: string): void {
    payFromBank(playerId, this.id, BonusTile.LANDING - BonusTile.PASSING);
    bus.emit('player:landed', { playerId, tileId: this.id });
  }
}

/**
 * Half a junction. Landing on one draws a travel voucher in the printed rules,
 * and this build has no vouchers — see KNOWNISSUES — so stopping here does
 * nothing. Its real work happens in `game/Movement.ts` when somebody goes *past*.
 */
class TransitTile extends Tile {
  onLand(playerId: string): void {
    bus.emit('ui:notification', {
      message: 'Transit Station — an even roll from here rides to the other track.',
      type: 'info',
    });
    bus.emit('player:landed', { playerId, tileId: this.id });
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerUltimateTiles(): void {
  registerTileType('cabCompany', (def) => new CabCompanyTile(def));
  registerTileType('utility',    (def) => new LadderUtilityTile(def));
  registerTileType('transit',    (def) => new TransitTile(def));
  registerTileType('payDay',     (def) => new PayDayTile(def));
  registerTileType('bonus',      (def) => new BonusTile(def));

  for (const effect of [
    'tunnel', 'subway', 'squeezePlay', 'taxRefund', 'birthdayGift',
    'auctionAny', 'busTicket', 'rollThree', 'stockExchange', 'reverse',
  ]) {
    registerTileType(effect, (def) => new EffectTile(def, effect));
  }

  registerUltimateEffects();
}

// ─── The effects ──────────────────────────────────────────────────────────────

/**
 * Players mid-jump between the two Holland Tunnels. Cleared on `turn:start` as
 * well as on arrival, so a jump interrupted by a bankruptcy cannot leave a
 * player permanently unable to use a tunnel again.
 */
const arrivingByTunnel = new Set<string>();
bus.on<{ playerId: string }>('turn:start', ({ playerId }) => {
  arrivingByTunnel.delete(playerId);
});

function registerUltimateEffects(): void {
  /**
   * Straight to the other tunnel — the only way between the outer and inner
   * tracks, since every junction joins neighbours.
   *
   * The far end is a tunnel too, so arriving there fires this same effect and
   * sends the player straight back: the first run of this game died in a
   * stack overflow bouncing between tiles 54 and 114. The printed rule is
   * "the space is only in play if a player lands on it" — arriving *through*
   * the tunnel is not landing on it — so an arrival is remembered across the
   * walk and consumed at the far end. The same shape as `arrivalRent`, and for
   * the same reason: the tile you arrive at cannot see how you got there.
   */
  registerTileEffect('tunnel', (_ctx, player, { tileId }) => {
    if (arrivingByTunnel.delete(player.id)) {
      bus.emit('player:landed', { playerId: player.id, tileId });
      return;
    }
    const other = TUNNELS.find((id) => id !== tileId);
    if (other === undefined) {
      bus.emit('player:landed', { playerId: player.id, tileId });
      return;
    }
    arrivingByTunnel.add(player.id);
    bus.emit('ui:notification', {
      message: `🚇 ${player.name} takes the Holland Tunnel across.`, type: 'info',
    });
    // Direct: no pay corner is passed and no salary collected, so the model is
    // moved outright rather than walked. The `player:move` the driver animates
    // still resolves the landing at the far end.
    const from = player.position;
    player.position = other;
    bus.emit('player:move', {
      playerId: player.id, from, to: other, path: [other], steps: 1, isDoubles: false,
    });
  });

  /**
   * The printed Subway lets you go to *any* space on your next turn. Choosing a
   * space needs a prompt a bot can answer and this build has none — the same wall
   * the speed die's triples rule hit — so it takes the best deterministic version
   * of the same idea: on to the next property nobody owns, wherever it is.
   */
  registerTileEffect('subway', (ctx, player, { tileId }) => {
    const target = ctx.board.scan(
      player.position, (tile) => isOwnable(tile) && tile.ownerId === null,
    );
    if (target === null) {
      bus.emit('player:landed', { playerId: player.id, tileId });
      return;
    }
    bus.emit('ui:notification', {
      message: `🚈 ${player.name} rides the Subway to ${ctx.board.getTile(target).name}.`,
      type: 'info',
    });
    ctx.walkTo(player, target);
  });

  /** Roll two dice; the spread decides what everybody else hands over. */
  registerTileEffect('squeezePlay', (ctx, player, { tileId }) => {
    const roll = 2 + Math.floor(rng.next() * 6) + Math.floor(rng.next() * 6);
    const each = roll === 2 || roll === 12 ? 200 : roll <= 4 || roll >= 10 ? 100 : 50;

    let taken = 0;
    for (const other of ctx.players) {
      if (other.id === player.id || other.isBankrupt) continue;
      ctx.charge(other, player, each);
      taken += each;
    }
    bus.emit('ui:notification', {
      message: `🎲 Squeeze Play — ${player.name} rolled ${roll} and collected $${each} each ($${taken}).`,
      type: 'success',
    });
    bus.emit('player:landed', { playerId: player.id, tileId });
  });

  /** Half of whatever the taxes have pooled. Worth nothing with the jackpot off. */
  registerTileEffect('taxRefund', (ctx, player, { tileId }) => {
    const refund = Math.ceil(ctx.bank.pot / 2);
    if (refund > 0) {
      ctx.bank.pot -= refund;
      ctx.award(player, refund);
      bus.emit('ui:notification', {
        message: `💸 Tax Refund — ${player.name} took $${refund} from the pool.`, type: 'success',
      });
    } else {
      bus.emit('ui:notification', { message: 'Tax Refund — the pool is empty.', type: 'info' });
    }
    bus.emit('player:landed', { playerId: player.id, tileId });
  });

  /** $100 from everybody. The printed rule offers a travel voucher instead. */
  registerTileEffect('birthdayGift', (ctx, player, { tileId }) => {
    let taken = 0;
    for (const other of ctx.players) {
      if (other.id === player.id || other.isBankrupt) continue;
      ctx.charge(other, player, 100);
      taken += 100;
    }
    bus.emit('ui:notification', {
      message: `🎁 ${player.name}'s birthday — $${taken} in gifts.`, type: 'success',
    });
    bus.emit('player:landed', { playerId: player.id, tileId });
  });

  /**
   * Pick an unowned property for the bank to auction. The printed rule lets the
   * player choose; without a pick-a-tile prompt this takes the dearest one, which
   * is at least the choice a player would usually make.
   */
  registerTileEffect('auctionAny', (ctx, player, { tileId }) => {
    let best: { id: number; price: number } | null = null;
    for (let id = 0; id < ctx.board.size; id++) {
      const tile = ctx.board.getTile(id);
      if (!isOwnable(tile) || tile.ownerId !== null) continue;
      if (!best || tile.price > best.price) best = { id, price: tile.price };
    }
    if (!best) {
      bus.emit('ui:notification', { message: 'Auction — everything is owned.', type: 'info' });
      bus.emit('player:landed', { playerId: player.id, tileId });
      return;
    }
    // The auction ends the turn itself, the way a declined property's does.
    bus.emit('property:auction', {
      tileId: best.id, playerId: player.id, price: best.price,
    });
  });

  /**
   * A bus ticket is a card you keep and play later, and a held card is per-player
   * state this build cannot save — see KNOWNISSUES. Spent immediately instead,
   * which is what it does when it is played: on to the next Chance or Chest.
   */
  registerTileEffect('busTicket', (ctx, player, { tileId }) => {
    const target = ctx.board.scan(
      player.position, (tile) => tile.type === 'chance' || tile.type === 'communityChest',
    );
    if (target === null) {
      bus.emit('player:landed', { playerId: player.id, tileId });
      return;
    }
    bus.emit('ui:notification', {
      message: `🚌 ${player.name} takes the bus to ${ctx.board.getTile(target).name}.`,
      type: 'info',
    });
    ctx.walkTo(player, target);
  });

  /**
   * Three dice against a number. Everybody holds a Roll Three card in the printed
   * game; nobody can here, so the roller plays against a number drawn with them
   * and wins the same prizes for matching one, two or three of it.
   */
  registerTileEffect('rollThree', (ctx, player, { tileId }) => {
    const die   = () => 1 + Math.floor(rng.next() * 6);
    const rolled = [die(), die(), die()];
    const target = [die(), die(), die()];

    const pool = [...target];
    let matches = 0;
    for (const face of rolled) {
      const at = pool.indexOf(face);
      if (at >= 0) { pool.splice(at, 1); matches++; }
    }
    const prize = [0, 50, 200, 1000][matches];
    if (prize > 0) ctx.award(player, prize);

    bus.emit('ui:notification', {
      message: `🎲 Roll Three — ${rolled.join('-')} against ${target.join('-')}: ` +
               (prize > 0 ? `${matches} matched, $${prize}!` : 'no matches.'),
      type: prize > 0 ? 'success' : 'info',
    });
    bus.emit('player:landed', { playerId: player.id, tileId });
  });

  /**
   * Shares are per-player state too, so there is nothing to buy and nothing to
   * hold. What survives is the dividend — the part everybody at the table feels —
   * paid to whoever stops here.
   */
  registerTileEffect('stockExchange', (ctx, player, { tileId }) => {
    const dividend = 100 + 50 * Math.floor(rng.next() * 4);
    ctx.award(player, dividend);
    bus.emit('ui:notification', {
      message: `📈 Stock Exchange — ${player.name} drew a $${dividend} dividend.`,
      type: 'success',
    });
    bus.emit('player:landed', { playerId: player.id, tileId });
  });

  /**
   * Reverse Direction turns you round for your *next* turn, which is a per-player
   * flag the snapshot has no room for. Taken now instead: straight back the way
   * you came, as far as the roll that brought you here.
   */
  registerTileEffect('reverse', (ctx, player, { tileId }) => {
    const steps = ctx.dice.lastResult?.total ?? 0;
    if (steps <= 0) {
      bus.emit('player:landed', { playerId: player.id, tileId });
      return;
    }
    const from = player.position;
    const { to, path } = ctx.board.move(from, -steps);
    player.position = to;
    bus.emit('ui:notification', {
      message: `↩️ Reverse Direction — ${player.name} goes back ${steps}.`, type: 'warning',
    });
    // Backwards, so no `announcePassing`: going back over a pay corner has never
    // paid and must not start now.
    bus.emit('player:move', {
      playerId: player.id, from, to, path, steps, isDoubles: false, direction: -1,
    });
  });
}

/** Exported for the tests, which check the ladders rather than re-deriving them. */
export const LADDERS = {
  cab: CabCompanyTile.RENT,
  utility: LadderUtilityTile.LADDER,
  payDay: { passing: PayDayTile.PASSING, landing: PayDayTile.LANDING },
  bonus: { passing: BonusTile.PASSING, landing: BonusTile.LANDING },
};

/** Kept honest by a test: every effect a tile names has to have a handler. */
export const EFFECT_TILE_TYPES = [
  'tunnel', 'subway', 'squeezePlay', 'taxRefund', 'birthdayGift',
  'auctionAny', 'busTicket', 'rollThree', 'stockExchange', 'reverse',
] as const;
