import type { Player } from './Player';

// ─── Auction ──────────────────────────────────────────────────────────────────
// A declined property goes under the hammer. Round-robin bidding: each active
// bidder in turn either raises or passes, and a pass forfeits — you do not get
// asked again. The auction ends when nobody is left to outbid the leader.
//
// No timer lives here. The UI runs a countdown and calls pass() when it expires,
// which keeps the rule (a pass is final) in one place and the clock in the other.
//
// What is under the hammer is a *subject*, not a tile id. Bidding is the same
// procedure whatever is being sold, and two other rules already want it: houses
// the bank is short of go to auction (ROADMAP 8b), and a bankrupt player's
// estate returned to the bank should be sold deed by deed (KNOWNISSUES). A tile
// id in the constructor made both of those need a second implementation of
// round-robin bidding, which is the wrong thing to have two of.

/** What is being sold. `kind` says how to read `id`. */
export interface AuctionSubject {
  /** `'tile'` is the one the base game uses; a variant may add its own. */
  kind: string;
  /** A tile id for `'tile'`; whatever the kind means otherwise. */
  id: number;
  /** What the panel calls it. */
  label: string;
}

export interface AuctionResult {
  subject: AuctionSubject;
  winnerId: string | null;   // null when every bidder passed without a bid
  amount: number;
}

/** An auction between saves. See `Auction.capture`. */
export interface AuctionSnapshot {
  subject: AuctionSubject;
  increment: number;
  reserve: number;
  /** Still in the running, in seat order. A pass has already removed them. */
  bidderIds: string[];
  /** Index into `bidderIds` of whoever is to bid. */
  turn: number;
  highBid: number;
  highBidderId: string | null;
}

export const MIN_BID_INCREMENT = 10;

/** The subject for the ordinary case: a deed nobody bought. */
export function tileSubject(id: number, label: string): AuctionSubject {
  return { kind: 'tile', id, label };
}

export class Auction {
  readonly subject: AuctionSubject;
  readonly increment: number;
  /** The opening price. Defaults to one increment, which is no reserve at all. */
  readonly reserve: number;

  /** Bidders still in, in seat order. A pass removes one for good. */
  private active: Player[];
  private turn = 0;

  highBid = 0;
  highBidderId: string | null = null;
  complete = false;

  constructor(
    subject: AuctionSubject, bidders: Player[],
    increment: number = MIN_BID_INCREMENT, reserve: number = increment,
  ) {
    this.subject   = subject;
    this.increment = increment;
    this.reserve   = Math.max(reserve, increment);
    this.active    = bidders.filter((p) => !p.isBankrupt);
    if (this.active.length === 0) this.complete = true;
  }

  /** The tile under the hammer, or null when it is not a tile that is being sold. */
  get tileId(): number | null {
    return this.subject.kind === 'tile' ? this.subject.id : null;
  }

  /** Whose turn it is to bid or pass, or null once the auction is over. */
  get currentBidder(): Player | null {
    if (this.complete || this.active.length === 0) return null;
    return this.active[this.turn % this.active.length];
  }

  get bidders(): readonly Player[] {
    return this.active;
  }

  /**
   * The lowest bid that would be accepted right now. The first bid has to clear
   * the reserve — a deed has none, but a contested house does, or scarcity would
   * make houses *cheaper* than the printed price.
   */
  get minimumBid(): number {
    return this.highBid === 0 ? this.reserve : this.highBid + this.increment;
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

  // ─── Saving ─────────────────────────────────────────────────────────────────
  // An auction is plain model state and always was, which is why it can be put
  // down and picked up: what is under the hammer, who is still in, whose turn it
  // is and what the standing bid is. The **clock is not here** and never was —
  // it is a `scene.time` event the panel owns — so a restored auction simply
  // starts its countdown again, which is the honest cost and the only one.

  capture(): AuctionSnapshot {
    return {
      subject:      { ...this.subject },
      increment:    this.increment,
      reserve:      this.reserve,
      bidderIds:    this.active.map((p) => p.id),
      turn:         this.turn,
      highBid:      this.highBid,
      highBidderId: this.highBidderId,
    };
  }

  /**
   * Rebuild one. `players` is the restored table, so the bidders come back as
   * the *same objects* the rest of the game holds — an auction bidding against
   * copies would settle against cash nobody has.
   *
   * A bidder missing from the table (bankrupt and gone) is dropped rather than
   * faked, and `turn` is clamped, so a save written by a build that ordered
   * bidders differently cannot point at nobody.
   */
  static restore(saved: AuctionSnapshot, players: Player[]): Auction {
    const bidders = saved.bidderIds
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is Player => p !== undefined);

    const auction = new Auction(saved.subject, bidders, saved.increment, saved.reserve);
    auction.highBid      = saved.highBid;
    auction.highBidderId = saved.highBidderId;
    auction.turn         = bidders.length ? saved.turn % bidders.length : 0;
    // The bid that was standing may already have decided it — a restore must not
    // reopen an auction the saved game had settled.
    auction.settleIfDecided();
    return auction;
  }

  get result(): AuctionResult | null {
    if (!this.complete) return null;
    return { subject: this.subject, winnerId: this.highBidderId, amount: this.highBid };
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
