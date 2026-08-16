import { bus } from '@/utils/EventBus';
import { rng } from '@/utils/PRNG';
import { Tile, isOwnable, type PassContext, type TileDefinition } from '@/tiles/Tile';
import { RailroadTile, UtilityTile } from '@/tiles/SpecialTiles';
import { registerTileType } from '@/tiles/registry';
import { registerTileEffect, type TileEffectContext } from '@/game/TileEffects';
import { countHeld, giveHolding, registerHolding, takeHolding } from '@/game/Holdings';
import { askChoice } from '@/game/Choice';
import { tileSubject } from '@/game/Auction';
import type { Player } from '@/game/Player';
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
//
// The two of them are the two shapes that rule takes, which is why they are
// worth reading together: BONUS pays more for stopping, so it pays the
// difference in `onLand`. PAY DAY pays the same either way — its number comes
// from the *roll*, not from whether you stopped — so it pays nothing extra.

/**
 * "When a player passes or lands on PAY DAY they collect $300 if they rolled an
 * odd number or $400 if they rolled an even number. If you move directly to PAY
 * DAY (via an ACTION CARD or TRAVEL SPACE) you collect $400, regardless of what
 * you rolled previously."
 *
 * Both halves of that fall out of `ctx.roll`, which is what M12c added: the
 * parity when the dice moved you, and `null` — the maximum — when something else
 * did. Until then a tile could not see the roll at all, and this square paid
 * $300 for passing and $400 for landing: a rule that reads plausibly, appears
 * nowhere in the book, and is right about a quarter of the time by accident.
 */
class PayDayTile extends Tile {
  static readonly ODD  = 300;
  static readonly EVEN = 400;

  /** Direct arrivals pay the maximum, and a direct arrival is `roll === null`. */
  static amountFor(roll: number | null): number {
    return roll === null || roll % 2 === 0 ? PayDayTile.EVEN : PayDayTile.ODD;
  }

  override onPass(playerId: string, ctx: PassContext): void {
    payFromBank(playerId, this.id, PayDayTile.amountFor(ctx.roll));
  }

  onLand(playerId: string): void {
    // Nothing extra. `onPass` has already fired for this tile — that is what
    // "the landing tile included" means — and Pay Day pays the same for
    // stopping as for walking over.
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
 * Half a junction. "If a player lands directly on the TRANSIT STATION space,
 * they should draw a TRAVEL VOUCHER" — which it does, since M12b gave a player
 * somewhere to keep one. Its *other* work happens in `game/Movement.ts`, when
 * somebody goes past rather than stopping.
 *
 * A `tile:effect` rather than a direct `giveHolding`, because a tile is handed a
 * player id and nothing else — it cannot reach the player it is talking about.
 */
class TransitTile extends Tile {
  onLand(playerId: string): void {
    bus.emit('tile:effect', { playerId, tileId: this.id, effect: 'busTicket' });
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** The kind a travel voucher is. Named once, used by the tiles and the menu. */
export const VOUCHER = 'travelVoucher';

export function registerUltimateTiles(): void {
  // Six companies, five certificates each — thirty, as the equipment list says.
  // Each is its own kind, which is what makes "how many of Acme does she hold"
  // a count rather than a list of objects with identity.
  for (const company of STOCK_COMPANIES) {
    registerHolding(stockKind(company), {
      label: `${STOCK_LABELS[company]} share`,
      plural: `${STOCK_LABELS[company]} shares`,
      // The block is five, and a player may hold all of it — that is the
      // "entire block" the dividend ladder rewards.
      limit: SHARES_PER_COMPANY,
      value: STOCK_PAR,
      // A share is an asset, so it goes with the estate.
      onBankruptcy: 'transfer',
    });
  }

  registerHolding(VOUCHER, {
    label: 'travel voucher',
    plural: 'travel vouchers',
    // The printed game deals 36 between everybody; four in one hand is already
    // more than a turn can spend, and a cap keeps the census honest.
    limit: 4,
    // What a bot will pay for one in a trade. A voucher reaches any square, so
    // it is worth about what a mid-priced deed is worth *reaching*.
    value: 60,
    // They go with the estate, like the deeds and the jail cards.
    onBankruptcy: 'transfer',
  });

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
  // `playVoucher` has no tile of its own — nobody lands on it. It is an effect a
  // *player* asks for from the inventory, which is what makes a holding
  // something you spend rather than something you merely have.

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
   * "Travel to any space on the board." A real choice since M12a — the whole
   * board is offered and whoever is sitting there picks a square.
   *
   * What a bot picks is the deed it would most like to be standing on, which is
   * the *same* answer the deterministic version used to give everybody. That is
   * the shape of every one of these rewrites: the reduction was never wrong as a
   * bot's answer, only as a person's.
   *
   * Still reduced in one way, and it is the printed rule rather than the prompt:
   * the Subway moves you on your *next* turn, and a facing that survives a turn
   * is per-player state this build cannot save. See KNOWNISSUES.
   */
  registerTileEffect('subway', (ctx, player, { tileId }) => {
    const ride = (target: number) => {
      bus.emit('ui:notification', {
        message: `🚈 ${player.name} rides the Subway to ${ctx.board.getTile(target).name}.`,
        type: 'info',
      });
      // "Movement from SUBWAY is considered direct movement, and does not
      // entitle you to salary collected for passing any PAY CORNER."
      ctx.walkTo(player, target, { direct: true });
    };

    const asked = askChoice({
      id: 'subway',
      playerId: player.id,
      prompt: 'Subway — travel to any space',
      style: 'board',
      options: ctx.board.tiles
        .map((tile, id) => ({
          id: String(id),
          label: tile.name,
          tileId: id,
          // An unowned deed is worth going to, because you may buy it there.
          // Everything else is worth nothing, and somebody else's is worth less.
          weight: isOwnable(tile) && tile.ownerId === null ? tile.price : 0,
        }))
        .filter((option) => option.tileId !== player.position),
      answer: (optionId) => ride(Number(optionId)),
    });
    if (asked) return;

    // Nobody to ask — no options at all, on a board of one tile. Nothing to do.
    bus.emit('player:landed', { playerId: player.id, tileId });
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
   * "Pick an unowned property for the Banker to auction off." Two things were
   * wrong here before M12a and both are fixed: the *player* picks now, and what
   * follows is an auction rather than an offer to buy.
   *
   * That second one mattered more than it looks. Emitting `property:auction`
   * offered the square's own deed to the player who landed here — first refusal
   * on the property they had just nominated, which is close to the opposite of
   * the printed rule. `auction:open` goes straight under the hammer.
   */
  registerTileEffect('auctionAny', (ctx, player, { tileId }) => {
    const unowned = ctx.board.tiles.filter((tile) => isOwnable(tile) && tile.ownerId === null);
    if (!unowned.length) {
      bus.emit('ui:notification', { message: 'Auction — everything is owned.', type: 'info' });
      bus.emit('player:landed', { playerId: player.id, tileId });
      return;
    }

    const sell = (id: number) => {
      const tile = ctx.board.getTile(id);
      bus.emit('ui:notification', {
        message: `🔨 ${player.name} sends ${tile.name} to auction.`, type: 'info',
      });
      bus.emit('auction:open', { subject: tileSubject(id, tile.name), endsTurn: true });
    };

    const asked = askChoice({
      id: 'auctionAny',
      playerId: player.id,
      prompt: 'Choose a property for the bank to auction',
      style: 'board',
      options: unowned.map((tile) => ({
        id: String(tile.id),
        label: tile.name,
        tileId: tile.id,
        // A bot nominates the dearest, which is what it used to do for everybody.
        weight: (tile as typeof tile & { price: number }).price,
      })),
      answer: (optionId) => sell(Number(optionId)),
    });
    if (!asked) bus.emit('player:landed', { playerId: player.id, tileId });
  });

  /**
   * A bus ticket is a card you **keep and play later**, and since M12b it is one:
   * landing here draws a travel voucher into your inventory instead of spending
   * it on the spot. What to do with it is Pause → Inventory, or a bot's own turn.
   *
   * Landing directly on a transit station draws one too — the printed rule — and
   * that is `TransitTile`'s business rather than this one's.
   */
  registerTileEffect('busTicket', (_ctx, player, { tileId }) => {
    const drawn = giveHolding(player, VOUCHER);
    bus.emit('ui:notification', {
      message: drawn
        ? `🎟️ ${player.name} takes a travel voucher.`
        : `${player.name} is holding all the vouchers they may.`,
      type: drawn ? 'success' : 'info',
    });
    bus.emit('player:landed', { playerId: player.id, tileId });
  });

  /**
   * Spend one: travel to any space on the board. The same question the Subway
   * asks, and deliberately the same weights — a voucher is worth most for
   * reaching a deed nobody owns.
   */
  registerTileEffect('playVoucher', (ctx, player, { tileId }) => {
    if (takeHolding(player, VOUCHER) === 0) {
      bus.emit('player:landed', { playerId: player.id, tileId });
      return;
    }
    const asked = askChoice({
      id: 'voucher',
      playerId: player.id,
      prompt: 'Travel voucher — go to any space',
      style: 'board',
      options: ctx.board.tiles
        .map((tile, id) => ({
          id: String(id),
          label: tile.name,
          tileId: id,
          weight: isOwnable(tile) && tile.ownerId === null ? tile.price : 0,
        }))
        .filter((option) => option.tileId !== player.position),
      answer: (optionId) => {
        const target = Number(optionId);
        bus.emit('ui:notification', {
          message: `🎟️ ${player.name} spends a voucher for ${ctx.board.getTile(target).name}.`,
          type: 'info',
        });
        // A voucher is travel, so it is direct like the Subway. The printed rule
        // is about the *destination* — "if you use a TRAVEL VOUCHER to pass or
        // advance to a PAY CORNER, collect the highest amount offered by that
        // space, regardless of what you rolled" — which the arrival's
        // `roll: null` already gives. Whether the squares flown over also pay is
        // the ambiguous half, and it is read the same way as the Subway rather
        // than left to depend on which square you happened to choose.
        ctx.walkTo(player, target, { direct: true });
      },
    });
    if (!asked) bus.emit('player:landed', { playerId: player.id, tileId });
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
  /**
   * "The STOCK EXCHANGE allows you to purchase stocks when landing on the STOCK
   * EXCHANGE space and get paid dividends when anyone lands on it."
   *
   * Six companies, five shares each — the equipment list's thirty certificates —
   * and a share is a **holding**, which is the whole reason this rule became
   * reachable. It is countable and keyed by kind, so it is saved, traded,
   * transferred on bankruptcy and counted by the invariant census without any of
   * those learning what a share is.
   *
   * Two halves, in the order the rule states them:
   *
   *   1. **Dividends to every shareholder**, because the trigger is *anyone*
   *      landing here, not the owner doing something. This is the first rule in
   *      the build that pays somebody for a square they are not standing on.
   *   2. **The lander may buy one share** at par, from what the bank has left.
   *
   * How many shares the bank has left is *derived* — issued is what the players
   * hold between them — rather than stored. A second copy of that number is a
   * second thing to get wrong, and `sim/Invariants.ts` would not catch it: the
   * holdings census is deliberately not a conservation law, because a game mints
   * vouchers. Stock does not mint, and this is what keeps that true.
   */
  registerTileEffect('stockExchange', (ctx, player, { tileId }) => {
    payDividends(ctx, player);
    offerShare(ctx, player, tileId);
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
  // Not passing/landing: Pay Day is the one corner keyed off the roll instead.
  payDay: { odd: PayDayTile.ODD, even: PayDayTile.EVEN },
  bonus: { passing: BonusTile.PASSING, landing: BonusTile.LANDING },
};

/** Kept honest by a test: every effect a tile names has to have a handler. */
export const EFFECT_TILE_TYPES = [
  'tunnel', 'subway', 'squeezePlay', 'taxRefund', 'birthdayGift',
  'auctionAny', 'busTicket', 'rollThree', 'stockExchange', 'reverse',
] as const;

// ─── The stock exchange ───────────────────────────────────────────────────────

/**
 * The six companies, and the five certificates each that the equipment list
 * counts. The par value and the dividend ladder are **derived rather than
 * quoted**: the rules say both are "printed on the STOCK CERTIFICATES" and the
 * certificates are not in the reference, so they are made consistent instead of
 * guessed at one company at a time — the same bargain `board.ts` makes with the
 * sixty-four title deeds.
 */
export const STOCK_COMPANIES = [
  'generalRadio', 'unitedRailways', 'nationalUtilities',
  'acmeMotors', 'alliedSteamships', 'motionPictures',
] as const;

export const STOCK_LABELS: Record<string, string> = {
  generalRadio:      'General Radio',
  unitedRailways:    'United Railways',
  nationalUtilities: 'National Utilities',
  acmeMotors:        'Acme Motors',
  alliedSteamships:  'Allied Steamships',
  motionPictures:    'Motion Pictures',
};

/** Certificates the bank starts with, per company. */
export const SHARES_PER_COMPANY = 5;
/** What one costs from the bank. */
export const STOCK_PAR = 150;

/**
 * What a shareholder is paid per landing, by how many of that company they hold.
 *
 * "It is an advantage to own the entire block of Stock of a Company, as the
 * Dividends increase considerably with the amount owned in any one Company" —
 * so this rises faster than the share count, which is the whole of that
 * sentence. `[1]` is one share.
 */
export const STOCK_DIVIDEND = [0, 25, 60, 110, 180, 300];

/** The holding kind for a company's shares. */
export const stockKind = (company: string): string => `stock.${company}`;

/** How many of a company are out in players' hands — the bank holds the rest. */
function sharesIssued(players: Player[], company: string): number {
  return players.reduce((n, p) => n + countHeld(p, stockKind(company)), 0);
}

/** The bank pays every shareholder, whoever landed. */
function payDividends(ctx: TileEffectContext, lander: Player): void {
  for (const holder of ctx.players) {
    if (holder.isBankrupt) continue;
    let paid = 0;
    for (const company of STOCK_COMPANIES) {
      const held = countHeld(holder, stockKind(company));
      paid += STOCK_DIVIDEND[Math.min(held, SHARES_PER_COMPANY)] ?? 0;
    }
    if (paid <= 0) continue;
    ctx.award(holder, paid);
    bus.emit('ui:notification', {
      message: holder.id === lander.id
        ? `📈 ${holder.name} collects $${paid} in dividends.`
        : `📈 ${holder.name} collects $${paid} in dividends from ${lander.name}'s landing.`,
      type: 'success',
    });
  }
}

/**
 * "You have the option of buying from the Bank one share of Stock in any
 * Company you choose, paying the Par Value price."
 *
 * A bot ranks by how many of that company it already holds, which is the
 * dividend ladder read backwards — the block is worth more than the spread, and
 * that is the printed advice rather than a policy of ours.
 */
function offerShare(ctx: TileEffectContext, player: Player, tileId: number): void {
  const available = STOCK_COMPANIES.filter(
    (company) => sharesIssued(ctx.players, company) < SHARES_PER_COMPANY,
  );
  const land = () => bus.emit('player:landed', { playerId: player.id, tileId });

  if (!available.length || !player.canAfford(STOCK_PAR)) {
    land();
    return;
  }

  const asked = askChoice({
    id: 'stock',
    playerId: player.id,
    prompt: `Buy a share at $${STOCK_PAR}?`,
    style: 'list',
    options: [
      ...available.map((company) => ({
        id: company,
        label: `${STOCK_LABELS[company]} — $${STOCK_PAR}`,
        weight: 1 + countHeld(player, stockKind(company)),
      })),
      { id: 'none', label: 'Buy nothing', weight: 0 },
    ],
    answer: (optionId) => {
      // Checked again rather than trusted. `askChoice` only ever offers what is
      // available, but an answer arrives from outside this function — a driver,
      // a bot, a restored prompt — and the one thing that must not happen here
      // is a sixth certificate of a five-share company, which nothing downstream
      // would catch: the holdings census counts kinds, not issues.
      if (optionId === 'none'
          || !available.includes(optionId as typeof available[number])
          || !player.canAfford(STOCK_PAR)) {
        land();
        return;
      }
      ctx.charge(player, null, STOCK_PAR);
      giveHolding(player, stockKind(optionId), 1);
      bus.emit('ui:notification', {
        message: `📈 ${player.name} buys a share of ${STOCK_LABELS[optionId]}.`,
        type: 'info',
      });
      land();
    },
  });

  // A rule that asks must survive nobody listening.
  if (!asked) land();
}
