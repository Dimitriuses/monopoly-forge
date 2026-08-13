import { bus } from '@/utils/EventBus';
import { dlog, dwarn } from '@/utils/log';
import { PropertyTile } from '@/tiles/PropertyTile';
import type { Board } from '@/game/Board';
import type { Bank } from '@/game/Bank';
import type { Player } from '@/game/Player';
import type { Card, CardAction } from './CardDeck';

// ─── Card-effect registry ─────────────────────────────────────────────────────
// What a card can do. `CardEffects.execute()` used to be a `switch` over the
// `CardAction` union, which closed the set: a game could not add an effect
// without editing the engine. An effect is a name and a handler now.
//
// Handlers get a small context rather than the CardEffects instance, so what an
// effect is allowed to touch stays visible in one place.

export interface CardEffectContext {
  board: Board;
  bank: Bank;
  players: Player[];
  /** Walk a player to a tile, paying the salary if the path passes the start. */
  advanceTo(player: Player, tileId: number): void;
  /** The next tile of a type going forwards, or null if the map has none. */
  nearest(from: number, type: string): number | null;
  /** Take money, raising cash and settling a bankruptcy if it comes to that. */
  charge(debtor: Player, creditor: Player | null, amount: number): void;
}

export interface CardEffectHandler {
  (ctx: CardEffectContext, action: CardAction, player: Player, card: Card): void;
}

export const CARD_EFFECTS = new Map<string, CardEffectHandler>();

/** Teach the engine a card effect. Registering over a name replaces it. */
export function registerCardEffect(type: string, handler: CardEffectHandler): void {
  CARD_EFFECTS.set(type, handler);
}

export function knownCardEffects(): string[] {
  return [...CARD_EFFECTS.keys()];
}

// ─── The built-in effects ─────────────────────────────────────────────────────
// Cast at the edge: the registry is keyed by string, so a handler knows the
// shape of the action it was registered for.

registerCardEffect('advanceTo', (ctx, action, player) => {
  ctx.advanceTo(player, (action as { tile: number }).tile);
});

registerCardEffect('advanceToGo', (ctx, _action, player) => {
  ctx.advanceTo(player, ctx.board.anchor('start'));
});

registerCardEffect('advanceToNearest', (ctx, action, player) => {
  const kind = (action as { kind: 'railroad' | 'utility' }).kind;
  const target = ctx.nearest(player.position, kind);
  if (target === null) {
    dwarn(`[CardEffects] advanceToNearest: this map has no ${kind} — card ignored`);
    return;
  }
  // Arriving by card changes what the tile charges: a railroad costs twice its
  // usual rate, a utility ten times the dice however many the owner holds. The
  // tile cannot know how the player got there, so the rule travels with the move
  // and is consumed by whoever resolves the rent.
  bus.emit('rent:modifier', {
    playerId: player.id,
    tileId:   target,
    rule:     kind === 'railroad' ? 'railroadDouble' : 'utilityTenTimes',
  });
  dlog(`[CardEffects] advanceToNearest ${kind}: ${player.name} pos ${player.position} → ${target}`);
  ctx.advanceTo(player, target);
});

registerCardEffect('goToJail', (ctx, _action, player) => {
  player.position = ctx.board.anchor('jail');
  player.inJail = true;
  player.jailTurns = 0;
  dlog(`[CardEffects] goToJail: ${player.name} → position=${player.position}`);
  bus.emit('jail:enter', { playerId: player.id, reason: 'card' });
});

registerCardEffect('goBack', (ctx, action, player) => {
  const spaces = (action as { spaces: number }).spaces;
  const from = player.position;
  const to   = ctx.board.move(from, -spaces).to;
  dlog(
    `[CardEffects] goBack ${spaces} spaces: ${player.name} pos ${from} → ${to} ` +
    `(tile: "${ctx.board.getTile(to).name}")`,
  );
  player.position = to;
  // direction: -1 makes the animation walk the tiles backwards. Without it the
  // token used to travel forwards and then snap back. Going back past the start
  // does NOT pay the salary, so no onPass here.
  bus.emit('player:move', {
    playerId: player.id, from, to, steps: spaces, isDoubles: false, direction: -1,
  });
  // resolveLanding() fires after the animation — do NOT call onLand here.
});

registerCardEffect('collectFromBank', (ctx, action, player) => {
  const amount = (action as { amount: number }).amount;
  dlog(`[CardEffects] collectFromBank: ${player.name} collects $${amount}`);
  ctx.bank.payPlayer(player, amount);
});

registerCardEffect('payBank', (ctx, action, player) => {
  const amount = (action as { amount: number }).amount;
  dlog(`[CardEffects] payBank: ${player.name} pays $${amount}`);
  ctx.charge(player, null, amount);
});

registerCardEffect('collectFromAll', (ctx, action, player) => {
  const amount = (action as { amount: number }).amount;
  dlog(`[CardEffects] collectFromAll: ${player.name} collects $${amount} from each player`);
  others(ctx, player).forEach((p) => ctx.charge(p, player, amount));
});

registerCardEffect('payAll', (ctx, action, player) => {
  const amount = (action as { amount: number }).amount;
  dlog(`[CardEffects] payAll: ${player.name} pays $${amount} to each player`);
  others(ctx, player).forEach((p) => ctx.charge(player, p, amount));
});

registerCardEffect('repairs', (ctx, action, player) => {
  const { houseCost, hotelCost } = action as { houseCost: number; hotelCost: number };
  let total = 0;
  player.ownedTileIds.forEach((id) => {
    const tile = ctx.board.getTile(id);
    if (tile instanceof PropertyTile) {
      total += tile.houses * houseCost + (tile.hasHotel ? hotelCost : 0);
    }
  });
  dlog(`[CardEffects] repairs: ${player.name} pays $${total} (houses×$${houseCost}, hotels×$${hotelCost})`);
  ctx.charge(player, null, total);
});

registerCardEffect('getOutOfJail', (_ctx, _action, player, card) => {
  // Hold the card itself: spending it returns it to the deck it came from.
  player.jailCards.push(card);
  dlog(`[CardEffects] getOutOfJail: ${player.name} now holds ${player.getOutOfJailCards} card(s)`);
});

function others(ctx: CardEffectContext, player: Player): Player[] {
  return ctx.players.filter((p) => p.id !== player.id && !p.isBankrupt);
}
