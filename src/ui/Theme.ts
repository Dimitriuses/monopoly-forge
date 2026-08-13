import type { ColorGroup, TokenType } from '@/config';

// ─── Theme ────────────────────────────────────────────────────────────────────
// What the game looks like, gathered into one object the way `GameRules` gathers
// what it costs. Until now the colours were spread across seven files as
// literals — `0xd4e8c2` for the board, `#f0c040` for a heading, a `TOKEN_HEX`
// table in `GameScene`, `GROUP_COLORS` in `config.ts` — and changing any of them
// meant finding all of them.
//
// Two decisions worth stating:
//
//   * **A theme is presentation, not state.** It is not in the snapshot and not
//     in `GameRules`: a saved game is the same game whatever colour it was
//     played in, and a person who prefers one palette should not have it
//     restored to somebody else's on load.
//   * **It is a singleton, reached through `theme()`.** Every drawn class needs
//     it, and threading one object through nine constructors would say nothing
//     that `theme()` does not. The same argument the event bus and the PRNG won.
//
// Colours are Phaser's two flavours by necessity: `number` for Graphics fills,
// `'#rrggbb'` strings for Text styles. Where a value is needed as both, it is
// held as a number and converted with `hex()`.

export interface Theme {
  id: string;
  /** What the selector calls it. */
  name: string;

  font: {
    /** Headings, labels, everything with a voice. */
    display: string;
    /** Small print on the board, where a serif at 6px is unreadable. */
    body: string;
  };

  board: {
    backdrop: number;
    tileOutline: number;
    /** Tile names, and the badge on an owner band. */
    tileLabel: string;
    ownerBadge: string;
    mortgageMark: string;
    selection: number;
    centreTitle: string;
    /** Drawn in the middle of the board, above the title. */
    emblem: string;
  };

  groups: Record<ColorGroup, number>;
  tokens: Record<TokenType, number>;

  panel: {
    background: number;
    backgroundAlpha: number;
    border: number;
    divider: number;
    /** A panel's headline — a tile's name, a bidder's name. */
    title: string;
    subtitle: string;
    body: string;
    /** Small print and anything deliberately quiet. */
    dim: string;
    /** The colour that means "this one". */
    accent: string;
    highlight: number;
    /** A list row under the cursor, unselected and selected. */
    rowHover: number;
    rowHoverSelected: number;
    button: { on: string; off: string; hover: string; text: string; textOff: string };
  };

  /** Everything around the board: the page, the HUD, the buttons under it. */
  chrome: {
    page: number;
    panel: number;
    panelBorder: number;
    heading: string;
    text: string;
    dim: string;
    positive: string;
    danger: string;
    /** The ordinary buttons under the board. */
    button: { fill: string; hover: string; text: string };
    /** ROLL DICE, and anything else that is *the* thing to press. */
    primary: { fill: string; hover: string; text: string };
  };

  /** The turn log's stripe and text, per kind of entry. */
  log: {
    accent: Record<LogKind, number>;
    text: Record<LogKind, string>;
    background: number;
  };
}

export type LogKind = 'info' | 'success' | 'warning' | 'danger';

// ─── The registry ─────────────────────────────────────────────────────────────

const THEMES = new Map<string, Theme>();

export function registerTheme(theme: Theme): void {
  THEMES.set(theme.id, theme);
}

export function knownThemes(): Theme[] {
  return [...THEMES.values()];
}

/** Unknown falls back to the classic look — a theme is never worth refusing to
 *  start over, unlike a rule the game cannot play. */
export function themeById(id: string | null | undefined): Theme {
  return (id && THEMES.get(id)) || CLASSIC_THEME;
}

let current: Theme;

export function setTheme(id: string | null | undefined): Theme {
  current = themeById(id);
  return current;
}

export function theme(): Theme {
  return current ?? CLASSIC_THEME;
}

/** A Graphics colour as a Text-style colour. */
export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// ─── The themes that ship ─────────────────────────────────────────────────────

export const CLASSIC_THEME: Theme = {
  id: 'classic',
  name: 'Classic',
  font: { display: 'Georgia, serif', body: 'Arial' },

  board: {
    backdrop:     0xd4e8c2,
    tileOutline:  0x555544,
    tileLabel:    '#111111',
    ownerBadge:   '#ffffff',
    mortgageMark: '#cc2222',
    selection:    0xf0c040,
    centreTitle:  '#222244',
    emblem:       '🏦',
  },

  groups: {
    brown:     0x8b4513,
    lightBlue: 0x87ceeb,
    pink:      0xff69b4,
    orange:    0xff8c00,
    red:       0xdc143c,
    yellow:    0xffd700,
    green:     0x228b22,
    darkBlue:  0x00008b,
  },

  tokens: {
    topHat:      0x222222,
    car:         0xe74c3c,
    dog:         0xe67e22,
    battleship:  0x3498db,
    iron:        0x95a5a6,
    boot:        0x8b4513,
    wheelbarrow: 0x2ecc71,
    thimble:     0xf1c40f,
  },

  panel: {
    background: 0x0b1220,
    backgroundAlpha: 0.96,
    border:    0x2a3a55,
    divider:   0x2a3a55,
    title:     '#f0c040',
    subtitle:  '#55667a',
    body:      '#aabbcc',
    dim:       '#55667a',
    accent:    '#f0c040',
    highlight: 0x1e3454,
    rowHover:  0x1a2640,
    rowHoverSelected: 0x2a4a74,
    button: {
      on: '#1a4a6b', off: '#232a36', hover: '#2a6b9b',
      text: '#ffffff', textOff: '#5a6478',
    },
  },

  chrome: {
    page:        0x1a1a2e,
    panel:       0x16213e,
    panelBorder: 0x2a3a55,
    heading:     '#f0c040',
    text:        '#ddeeff',
    dim:         '#7788aa',
    positive:    '#2ecc71',
    danger:      '#e74c3c',
    button:  { fill: '#2c3e6b', hover: '#3d5190', text: '#ffffff' },
    primary: { fill: '#c0392b', hover: '#e74c3c', text: '#ffffff' },
  },

  log: {
    accent: { info: 0x5577cc, success: 0x2ecc71, warning: 0xf0c040, danger: 0xe74c3c },
    text:   { info: '#c8d6e8', success: '#a9f0c1', warning: '#f5dfa0', danger: '#f3b0a8' },
    background: 0x121c30,
  },
};

/**
 * The same board on paper: warm ground, ink outlines, muted deed colours. It
 * exists to prove the seam — if a value is still a literal somewhere, this is
 * the theme that shows it, because every one of its colours is different.
 */
export const PARCHMENT_THEME: Theme = {
  id: 'parchment',
  name: 'Parchment',
  font: { display: '"Palatino Linotype", Georgia, serif', body: 'Arial' },

  board: {
    backdrop:     0xf2e6cf,
    tileOutline:  0x8a7a5c,
    tileLabel:    '#3b2f1c',
    ownerBadge:   '#fdf6e6',
    mortgageMark: '#a3341f',
    selection:    0x2f6f5f,
    centreTitle:  '#4a3a22',
    emblem:       '🖋️',
  },

  groups: {
    brown:     0x6b4a2f,
    lightBlue: 0x7fa8b8,
    pink:      0xc4788f,
    orange:    0xd08a45,
    red:       0xa8453c,
    yellow:    0xd6b756,
    green:     0x5c8055,
    darkBlue:  0x3b4a70,
  },

  tokens: {
    topHat:      0x3b2f1c,
    car:         0xa8453c,
    dog:         0xd08a45,
    battleship:  0x3b4a70,
    iron:        0x8a8578,
    boot:        0x6b4a2f,
    wheelbarrow: 0x5c8055,
    thimble:     0xd6b756,
  },

  panel: {
    background: 0x241c10,
    backgroundAlpha: 0.96,
    border:    0x6b5a3c,
    divider:   0x4a3c26,
    title:     '#e8c87a',
    subtitle:  '#9a8a6c',
    body:      '#d9cbb0',
    dim:       '#9a8a6c',
    accent:    '#e8c87a',
    highlight: 0x3d3220,
    rowHover:  0x362c1c,
    rowHoverSelected: 0x554527,
    button: {
      on: '#5c4a2c', off: '#2e2718', hover: '#7d6738',
      text: '#fdf6e6', textOff: '#7a6e58',
    },
  },

  chrome: {
    page:        0x1c1710,
    panel:       0x2b2216,
    panelBorder: 0x6b5a3c,
    heading:     '#e8c87a',
    text:        '#e6dbc2',
    dim:         '#9a8a6c',
    positive:    '#7fa86a',
    danger:      '#b8503f',
    button:  { fill: '#4a3c26', hover: '#6b5636', text: '#fdf6e6' },
    primary: { fill: '#8c4a2f', hover: '#b05f3c', text: '#fdf6e6' },
  },

  log: {
    accent: { info: 0x7f93b8, success: 0x7fa86a, warning: 0xd6b756, danger: 0xb8503f },
    text:   { info: '#cfc3aa', success: '#bcd3ab', warning: '#e6d69e', danger: '#e0b0a4' },
    background: 0x2b2216,
  },
};

registerTheme(CLASSIC_THEME);
registerTheme(PARCHMENT_THEME);
setTheme('classic');
