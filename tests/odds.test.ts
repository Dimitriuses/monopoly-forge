import { describe, it, expect } from 'vitest';
import { Board } from '@/game/Board';
import { landingOdds, trafficOf } from '@/game/BoardOdds';
import { ROUND_MAP, ORBIT_MAP } from '@/maps';
import { gameById } from '@/games';
import { unloadGame } from '@/games/scope';
import { PropertyTile } from '@/tiles/PropertyTile';

// ─── BoardOdds ────────────────────────────────────────────────────────────────
// The number the baseline bot never had. What matters is not the exact figures —
// the model leaves out the cards and the three-doubles rule — but that the
// *pattern* is right, and that it is derived from the board rather than known
// about the 1935 one.

describe('landing odds', () => {
  it('is a distribution', () => {
    for (const map of [undefined, ROUND_MAP, ORBIT_MAP]) {
      const board = new Board(map);
      const odds = landingOdds(board);
      expect(odds).toHaveLength(board.size);
      expect(odds.every((p) => p >= 0)).toBe(true);
      expect(odds.reduce((a, c) => a + c, 0)).toBeCloseTo(1, 6);
    }
  });

  /**
   * The famous fact about Monopoly, and the whole reason this file exists: Jail
   * is the busiest square, because Go To Jail feeds it. Nothing here is told
   * that — it falls out of running the chain.
   */
  it('finds Jail the busiest square on the classic board', () => {
    const board = new Board();
    const odds = landingOdds(board);
    const busiest = odds.indexOf(Math.max(...odds));
    expect(board.getTile(busiest).type).toBe('jail');
    expect(trafficOf(board, busiest)).toBeGreaterThan(1.8);
  });

  it('nobody is ever standing on Go To Jail', () => {
    const board = new Board();
    const odds = landingOdds(board);
    const goToJail = board.anchor('goToJail');
    expect(odds[goToJail]).toBe(0);
  });

  /** The other famous fact: the oranges pay, because they are a roll from Jail. */
  it('makes the oranges the busiest colour group', () => {
    const board = new Board();
    const groups = new Map<string, number>();
    for (const tile of board.tiles) {
      if (!(tile instanceof PropertyTile)) continue;
      groups.set(tile.group, (groups.get(tile.group) ?? 0) + trafficOf(board, tile.id));
    }
    const best = [...groups].sort((a, b) => b[1] - a[1])[0][0];
    expect(best).toBe('orange');
  });

  it('is derived, not tabulated — a different board gives a different answer', () => {
    const round = landingOdds(new Board(ROUND_MAP));
    const orbit = landingOdds(new Board(ORBIT_MAP));
    expect(round).not.toEqual(orbit);
    // Spread over the squares anybody can stand on. Go To Jail is 0 on every
    // board that has one, which would make this ratio infinite and say nothing.
    const standable = round.filter((p) => p > 0);
    expect(Math.max(...standable) / Math.min(...standable)).toBeLessThan(6);
  });

  it('walks a board that is three loops without leaving one', () => {
    const game = gameById('ultimate');
    const board = new Board(game.map, { movement: 'tracks' });
    const odds = landingOdds(board);

    // Every track has to carry some of the traffic — a chain that could not
    // cross would leave two of the three at zero.
    for (const track of board.tracks) {
      const share = odds.slice(track.from, track.from + track.count).reduce((a, c) => a + c, 0);
      expect(share, `nothing lands on ${track.id}`).toBeGreaterThan(0.01);
    }
    unloadGame();
  });

  it('is cached per board, so a bot may ask on every valuation', () => {
    const board = new Board();
    expect(landingOdds(board)).toBe(landingOdds(board));
  });
});
