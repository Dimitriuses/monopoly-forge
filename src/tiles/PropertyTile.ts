import { Tile, type TileDefinition } from './Tile';
import type { ColorGroup } from '@/config';
import { bus } from '@/utils/EventBus';

export class PropertyTile extends Tile {
  readonly group: ColorGroup;
  readonly price: number;
  readonly houseCost: number;
  readonly mortgage: number;
  /** rent[0]=bare, [1]–[4]=1–4 houses, [5]=hotel */
  readonly rentTiers: [number, number, number, number, number, number];

  ownerId: string | null = null;
  houses: number = 0;
  hasHotel: boolean = false;
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
    return this.hasHotel ? this.rentTiers[5] : this.rentTiers[this.houses];
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
      houses:     this.houses,
      hasHotel:   this.hasHotel,
      isMortgaged:this.isMortgaged,
    };
  }
}
