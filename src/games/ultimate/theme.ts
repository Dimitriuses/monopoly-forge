import { CLASSIC_THEME, registerTheme, type Theme } from '@/ui/Theme';

// ─── The Ultimate palette ─────────────────────────────────────────────────────
// Twenty colour groups, which is why `ColorGroup` had to open and why a theme's
// `groups` stopped being a total map. The classic eight keep their colours; the
// twelve this board adds get the ones the printed board uses.
//
// Naming them is a *preference*, not a requirement — that is the point of the
// derivation in `ui/Theme.ts`. Play Ultimate Monopoly in Classic or Parchment and
// the twelve new groups are still drawn, in colours worked out from their names
// and that theme's own saturation. This theme just gets them right.
//
// Registered at module scope rather than from `Game.register`, deliberately: a
// theme is not scoped to a game (see CLAUDE.md 11b), and the menu resolves
// `Game.theme` by id before anything is loaded.

export const ULTIMATE_THEME: Theme = {
  ...CLASSIC_THEME,
  id: 'ultimate',
  name: 'Ultimate',

  board: { ...CLASSIC_THEME.board, backdrop: 0xa8e0c8, emblem: '🎩' },

  groups: {
    ...CLASSIC_THEME.groups,

    // Outer track, counter-clockwise from the light pinks.
    minneapolis:  0xf4a6b8,
    newOrleans:   0x8fd98f,
    houston:      0xf5e6a0,
    atlanta:      0x179c8a,
    chicago:      0x8c1c3c,
    saltLake:     0xc99a2e,
    philadelphia: 0xf0a878,
    losAngeles:   0x7a1420,

    // Inner track.
    miami:        0xa0522d,
    sanFrancisco: 0xf5f5f5,
    boston:       0x1c1c1c,
    newYork:      0x8b8b8b,
  },
};

registerTheme(ULTIMATE_THEME);
