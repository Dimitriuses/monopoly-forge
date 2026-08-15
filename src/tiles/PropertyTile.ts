import { Tile, type TileDefinition } from './Tile';
import type { ColorGroup } from '@/config';
import { bus } from '@/utils/EventBus';

export class PropertyTile extends Tile {
  readonly group: ColorGroup;
  readonly price: number;
  readonly houseCost: number;
  readonly mortgage: number;
  /**
   * One tier per rung of the build ladder, plus the bare rate at `[0]`. Six on
   * the classic board (bare, 1–4 houses, hotel) and seven where a game builds
   * skyscrapers — a `number[]` rather than a six-tuple since M12d, because how
   * many tiers a lot needs is a question about the *game*, not about the map.
   * `validateGame` is where the two are checked against each other.
   */
  readonly rentTiers: number[];

  ownerId: string | null = null;
  /** The rung standing here; `rentTiers[level]` is what it charges. */
  level: number = 0;
  isMortgaged: boolean = false;

  constructor(def: TileDefinition) {
    super(def);
    if (!def.group || !def.price || !def.houseCost || !def.mortgage || !def.rent) {
      throw new Error(`PropertyTile "${def.name}" is missing required fields.`);
    }
    this.group     = def.group;
    this.price     = def.price;
    this.houseCost = def.houseCost;
    this.mortgage  = def.mortgage;
    this.rentTiers = def.rent;
  }

  get currentRent(): number {
    if (this.isMortgaged || !this.ownerId) return 0;
    // The level *is* the tier. A lot standing higher than its table is a
    // mismatch `validateGame` refuses, so the clamp is belt and braces rather
    // than a rule — but an `undefined` here would become `NaN` rent.
    return this.rentTiers[Math.min(this.level, this.rentTiers.length - 1)];
  }

  onLand(playerId: string): void {
    // ── Unowned: offer to buy ────────────────────────────────────────────────
    if (!this.ownerId) {
      bus.emit('property:auction', { tileId: this.id, playerId });
      return;
    }

    // ── Mortgaged or own property: free, auto-end turn ───────────────────────
    if (this.isMortgaged || this.ownerId === playerId) {
      bus.emit('player:landed', { playerId, tileId: this.id });
      return;
    }

    // ── Owned by someone else: pay rent ──────────────────────────────────────
    bus.emit('rent:pay', {
      debtorId:   playerId,
      creditorId: this.ownerId,
      amount:     this.currentRent,
      tileId:     this.id,
    });
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      group:      this.group,
      ownerId:    this.ownerId,
      level:      this.level,
      isMortgaged:this.isMortgaged,
    };
  }
}
