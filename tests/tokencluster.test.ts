import { describe, it, expect } from 'vitest';
import { tokenSlot } from '@/ui/TokenCluster';

const distance = (slot: { dx: number; dy: number }) => Math.hypot(slot.dx, slot.dy);
const slotsFor = (count: number) =>
  Array.from({ length: count }, (_, i) => tokenSlot(i, count));

describe('TokenCluster', () => {
  it('puts a lone token dead centre, full size', () => {
    expect(tokenSlot(0, 1)).toEqual({ dx: 0, dy: 0, scale: 1 });
  });

  it('puts two at the ends of a horizontal line', () => {
    const [left, right] = slotsFor(2);
    expect(left.dy).toBe(0);
    expect(right.dy).toBe(0);
    expect(left.dx).toBe(-right.dx);
    expect(left.dx).toBeLessThan(0);
  });

  it('puts three on the corners of a triangle, point up', () => {
    const slots = slotsFor(3);
    expect(slots[0].dx).toBe(0);
    expect(slots[0].dy).toBeLessThan(0);            // apex above centre
    expect(slots[1].dy).toBeGreaterThan(0);         // the other two below
    expect(slots[2].dy).toBeGreaterThan(0);
    expect(slots[1].dx).toBeCloseTo(-slots[2].dx, 1);
  });

  it('spaces every arrangement evenly around one ring', () => {
    for (let count = 2; count <= 6; count++) {
      const slots = slotsFor(count);
      const radii = slots.map(distance);
      radii.forEach((r) => expect(r).toBeCloseTo(radii[0], 1));

      // No two tokens in the same place.
      const seen = new Set(slots.map((s) => `${s.dx},${s.dy}`));
      expect(seen.size).toBe(count);
    }
  });

  it('balances around the centre, so the cluster is not lopsided', () => {
    for (let count = 2; count <= 6; count++) {
      const slots = slotsFor(count);
      const sumX = slots.reduce((n, s) => n + s.dx, 0);
      const sumY = slots.reduce((n, s) => n + s.dy, 0);
      expect(sumX).toBeCloseTo(0, 0);
      expect(sumY).toBeCloseTo(0, 0);
    }
  });

  // Six 22px pieces do not fit in a 56px tile at full size.
  it('shrinks the pieces as the tile gets busier', () => {
    const scales = [1, 2, 3, 4, 5, 6].map((n) => tokenSlot(0, n).scale);
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeLessThanOrEqual(scales[i - 1]);
    }
    expect(scales[5]).toBeGreaterThan(0.5);
  });

  it('keeps the whole cluster inside the narrow side of a tile', () => {
    const TILE_SHORT_SIDE = 56;
    const TOKEN = 22;
    for (let count = 1; count <= 6; count++) {
      for (const slot of slotsFor(count)) {
        const reach = distance(slot) + (TOKEN * slot.scale) / 2;
        expect(reach).toBeLessThanOrEqual(TILE_SHORT_SIDE / 2);
      }
    }
  });

  it('never asks for a slot it cannot place, even past six', () => {
    const slot = tokenSlot(6, 8);
    expect(Number.isFinite(slot.dx)).toBe(true);
    expect(Number.isFinite(slot.dy)).toBe(true);
    expect(slot.scale).toBeGreaterThan(0);
  });
});
