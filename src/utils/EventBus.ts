// ─── EventBus ──────────────────────────────────────────────────────────────────
// Lightweight typed pub/sub used to decouple game logic from Phaser scenes.

type Listener<T> = (payload: T) => void;

class EventBus {
  private listeners: Map<string, Set<Listener<unknown>>> = new Map();

  on<T>(event: string, listener: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(listener as Listener<unknown>);

    // Returns an unsubscribe function
    return () => set.delete(listener as Listener<unknown>);
  }

  once<T>(event: string, listener: Listener<T>): void {
    const unsub = this.on<T>(event, (payload) => {
      listener(payload);
      unsub();
    });
  }

  emit<T>(event: string, payload?: T): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload as unknown));
  }

  off(event: string): void {
    this.listeners.delete(event);
  }

  clear(): void {
    this.listeners.clear();
  }
}

// Singleton — import this everywhere instead of creating new instances
export const bus = new EventBus();

// ─── Typed event catalogue ─────────────────────────────────────────────────────
// Extend this union as new events are added.

export type GameEvent =
  | 'game:start'
  | 'game:end'
  | 'turn:start'
  | 'turn:end'
  /** Every phase the turn enters, including any a rule set added. */
  | 'turn:phase'
  | 'dice:roll'
  | 'dice:result'
  | 'player:move'
  | 'player:landed'
  | 'player:bankrupt'
  | 'property:buy'
  | 'property:auction'
  | 'property:mortgage'
  | 'property:unmortgage'
  | 'property:buildHouse'
  | 'property:buildHotel'
  | 'property:sellHouse'
  | 'property:sellHotel'
  | 'rent:pay'
  | 'rent:modifier'
  | 'tax:pay'
  /** A tile asking for a rule it cannot resolve alone — see game/TileEffects.ts. */
  | 'tile:effect'
  /** "Which one?", answered by a person or a bot — see game/Choice.ts. */
  | 'choice:ask'
  /** A roll rule picked a square — see game/RollRules.ts. */
  | 'roll:chosen'
  | 'card:draw'
  | 'card:execute'
  /** Cards leaving a bankrupt estate, for whoever holds the decks to put back. */
  | 'card:return'
  | 'jail:enter'
  | 'jail:exit'
  | 'trade:open'
  | 'trade:accept'
  | 'trade:decline'
  | 'auction:start'
  | 'auction:bid'
  | 'auction:end'
  | 'ui:notification';
