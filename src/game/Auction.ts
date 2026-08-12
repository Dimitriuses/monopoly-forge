import type { Player } from './Player';

// ─── Auction ──────────────────────────────────────────────────────────────────
// A declined property goes under the hammer. Round-robin bidding: each active
// bidder in turn either raises or passes, and a pass forfeits — you do not get
// asked again. The auction ends when nobody is left to outbid the leader.
//
// No timer lives here. The UI runs a countdown and calls pass() when it expires,
// which keeps the rule (a pass is final) in one place and the clock in the other.

export interface AuctionResult {
  tileId: number;
  winnerId: string | null;   // null when every bidder passed without a bid
  amount: number;
}

export const MIN_BID_INCREMENT = 10;

export class Auction {
  readonly tileId: number;
  readonly increment: number;

  /** Bidders still in, in seat order. A pass removes one for good. */
  private active: Player[];
  private turn = 0;

  highBid = 0;
  highBidderId: string | null = null;
  complete = false;

  constructor(tileId: number, bidders: Player[], increment: number = MIN_BID_INCREMENT) {
    this.tileId    = tileId;
    this.increment = increment;
    this.active    = bidders.filter((p) => !p.isBankrupt);
    if (this.active.length === 0) this.complete = true;
  }

  /** Whose turn it is to bid or pass, or null once the auction is over. */
  get currentBidder(): Player | null {
    if (this.complete || this.active.length === 0) return null;
    return this.active[this.turn % this.active.length];
  }

  get bidders(): readonly Player[] {
    return this.active;
  }

  /** The lowest bid that would be accepted right now. */
  get minimumBid(): number {
    return this.highBid + this.increment;
  }

  /** Whether this player could raise at all — used to grey out the bid buttons. */
  canBid(player: Player): boolean {
    return player.canAfford(this.minimumBid);
  }

  bid(playerId: string, amount: number): boolean {
    const bidder = this.currentBidder;
    if (!bidder || bidder.id !== playerId) return false;
    if (amount < this.minimumBid) return false;
    if (!bidder.canAfford(amount)) return false;

    this.highBid      = amount;
    this.highBidderId = bidder.id;
    this.advance();
    return true;
  }

  pass(playerId: string): boolean {
    const bidder = this.currentBidder;
    if (!bidder || bidder.id !== playerId) return false;

    // The next bidder slides into the seat just vacated, so the pointer stays.
    const seat = this.turn % this.active.length;
    this.active.splice(seat, 1);
    this.turn = seat;

    this.settleIfDecided();
    return true;
  }

  get result(): AuctionResult | null {
    if (!this.complete) return null;
    return { tileId: this.tileId, winnerId: this.highBidderId, amount: this.highBid };
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private advance(): void {
    this.turn++;
    this.settleIfDecided();
  }

  private settleIfDecided(): void {
    if (this.active.length === 0) {
      // Everyone passed. With a standing bid the last raiser still wins it.
      this.complete = true;
      return;
    }
    // One bidder left and it is their own bid on the table — nobody to outbid.
    if (this.active.length === 1 && this.active[0].id === this.highBidderId) {
      this.complete = true;
      return;
    }
    // A lone bidder who has not bid yet still has to bid or pass, so the
    // auction stays open. Normalise the pointer so it lands on someone real.
    this.turn %= this.active.length;
  }
}
