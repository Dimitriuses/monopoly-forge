import { describe, it, expect, afterEach } from 'vitest';
import {
  theme, setTheme, themeById, knownThemes, registerTheme, hex,
  CLASSIC_THEME, PARCHMENT_THEME, type Theme,
} from '@/ui/Theme';
import {
  registerTileDecoration, decorationFor, knownTileDecorations,
} from '@/ui/TileDecor';
import { TOKEN_LABELS } from '@/config';
import { CLASSIC_MAP, ROUND_MAP, ORBIT_MAP } from '@/maps';
import { PropertyTile } from '@/tiles/PropertyTile';
import { Board } from '@/game/Board';

describe('Themes', () => {
  afterEach(() => { setTheme('classic'); });

  it('ships two, and the classic one is the default', () => {
    expect(knownThemes().map((t) => t.id)).toEqual(['classic', 'parchment']);
    expect(theme().id).toBe('classic');
  });

  it('falls back rather than refusing an unknown one', () => {
    // A rule the game cannot play is worth refusing; a colour is not.
    expect(themeById('chartreuse')).toBe(CLASSIC_THEME);
    expect(themeById(null)).toBe(CLASSIC_THEME);
    expect(setTheme('parchment')).toBe(PARCHMENT_THEME);
    expect(theme().id).toBe('parchment');
  });

  it('converts a Graphics colour to a Text one', () => {
    // Phaser wants numbers for fills and '#rrggbb' strings for text styles, and
    // a theme holds one of them.
    expect(hex(0xf0c040)).toBe('#f0c040');
    expect(hex(0x000000)).toBe('#000000');
    expect(hex(0x0b1220)).toBe('#0b1220');
  });

  // The point of a second theme is that it catches what the first one hides. A
  // token or a colour group added to the game has to be given a colour in every
  // theme, or a piece comes out undefined-coloured only when you switch.
  it('gives every token and every colour group a colour, in every theme', () => {
    const groups = new Set<string>();
    for (const map of [CLASSIC_MAP, ROUND_MAP, ORBIT_MAP]) {
      for (const tile of new Board(map).tiles) {
        if (tile instanceof PropertyTile) groups.add(tile.group);
      }
    }

    for (const t of knownThemes()) {
      for (const token of Object.keys(TOKEN_LABELS)) {
        expect(t.tokens[token as keyof typeof t.tokens], `${t.id}/${token}`)
          .toEqual(expect.any(Number));
      }
      for (const group of groups) {
        expect(t.groups[group as keyof typeof t.groups], `${t.id}/${group}`)
          .toEqual(expect.any(Number));
      }
    }
  });

  it('takes one a game registers', () => {
    const mono: Theme = { ...CLASSIC_THEME, id: 'mono', name: 'Mono' };
    registerTheme(mono);
    expect(themeById('mono')).toBe(mono);
    expect(knownThemes().map((t) => t.id)).toContain('mono');
  });
});

describe('Tile decorations', () => {
  it('knows how to draw every built-in tile type', () => {
    for (const type of [
      'go', 'property', 'railroad', 'utility', 'tax',
      'chance', 'communityChest', 'jail', 'freeParking', 'goToJail',
    ]) {
      expect(knownTileDecorations(), type).toContain(type);
    }
  });

  // A blank rectangle with a name in it is a poor tile; a board that refuses to
  // draw is a worse one.
  it('falls back to drawing nothing for a type nobody decorated', () => {
    const decoration = decorationFor('wormhole');
    expect(decoration).toBeTypeOf('function');
    expect(() => decoration({} as never)).not.toThrow();
  });

  it('lets a game replace how a type draws', () => {
    const original = decorationFor('property');
    let ran = false;
    registerTileDecoration('property', () => { ran = true; });
    decorationFor('property')({} as never);
    expect(ran).toBe(true);
    registerTileDecoration('property', original);   // the registry is global
  });
});
