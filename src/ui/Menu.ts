import Phaser from 'phaser';
import { Surface } from './Retained';
import { theme, hex } from './Theme';

// ─── Menu ─────────────────────────────────────────────────────────────────────
// A stack of screens of labelled rows, and the only thing that knows how a menu
// looks. **Both menus render from it** — the title screen and the pause screen
// are the same object with different roots, which is the whole reason it exists:
// written as two scenes they would have drifted inside a milestone.
//
// A screen is *data*, rebuilt on every render rather than held. That matters
// more than it sounds: a row's label, value and enabled-ness are functions, so
// "Save — finish what you are doing first" is a row that answers for itself
// instead of a scene remembering to grey something out.
//
// The rendering follows 10c: rows are drawn onto a `Surface`, so a repaint
// writes to what is already there. `removeAll(true)` on a menu is what loses the
// hover under the cursor and re-registers a listener per press.

export type MenuItemKind = 'action' | 'submenu' | 'value' | 'heading' | 'back';

export interface MenuItem {
  /** Stable across renders — it is the Surface slot key and the harness's name. */
  id: string;
  label: string;
  kind?: MenuItemKind;
  /** The right-hand column: a setting's current value, a slot's date. */
  value?: string;
  /** Small print under the row. */
  hint?: string;
  /** Greyed out when false; `reason` says why, in place of the hint. */
  enabled?: boolean;
  reason?: string;
  /** Drawn in the palette's accent — for START, and anything that is *the* action. */
  primary?: boolean;
  onPress?(): void;
  /** Left/right on a value row. Rows with this get ‹ › affordances. */
  onAdjust?(delta: 1 | -1): void;
}

export interface MenuScreen {
  title: string;
  /** Under the title — a game's blurb, a warning, a count. */
  subtitle?: string;
  items: MenuItem[];
}

/**
 * Where a row is on screen, for the playtest harness. The nudge buttons are
 * reported too rather than left to be guessed from the row's centre: they are
 * 26px wide, and a harness computing their offset by hand is exactly the
 * hand-maintained coordinate table this replaced.
 */
export interface MenuSpot {
  id: string;
  label: string;
  x: number;
  y: number;
  enabled: boolean;
  /** The right-hand column as it currently reads, or null. */
  value: string | null;
  /** Centres of the ‹ and › buttons, when the row has them. */
  decX: number | null;
  incX: number | null;
}

// Row metrics. A row is a button plus, optionally, a line of small print under
// it — so rows are *not* a fixed pitch: `y` accumulates, and a row with a note is
// taller. Laying them out on a fixed grid is what put the first draft's hints
// underneath the next row's background.
const ROW_H   = 34;   // a plain row, button plus a hair of breathing room
const NOTE_H  = 14;   // what a hint or a reason adds
const BTN_H   = 31;   // the button itself, for centring the value against it
const ROW_W   = 560;
const TOP     = 205;

// The right-hand column, measured in from the row's right edge. The value sits
// *between* the two nudge buttons rather than under them: right-aligning it at
// the row edge is what made "Classic" and "Human" read through the ›.
const PAD_R    = 10;
const NUDGE_W  = 26;
const VALUE_W  = 130;

export class Menu {
  private surface: Surface;
  private container: Phaser.GameObjects.Container;
  /** The route in, so `back()` is a pop rather than a remembered parent. */
  private stack: Array<() => MenuScreen> = [];
  private scene: Phaser.Scene;
  private lastSpots: MenuSpot[] = [];

  constructor(scene: Phaser.Scene, root: () => MenuScreen, depth = 100) {
    this.scene = scene;
    this.container = scene.add.container(0, 0).setDepth(depth);
    this.surface = new Surface(scene, this.container);
    this.stack = [root];

    // Escape is back everywhere, and on the root it is whatever the owner says —
    // closing the pause menu, or nothing at all on the title screen.
    scene.input.keyboard?.on('keydown-ESC', () => this.back());
  }

  /** What the owner does when Escape is pressed on the root screen. */
  onExitRoot: (() => void) | null = null;

  get depth(): number {
    return this.stack.length;
  }

  /** Where every row is right now — see `__forge.menu()`. */
  spots(): MenuSpot[] {
    return this.lastSpots;
  }

  get title(): string {
    return this.stack[this.stack.length - 1]().title;
  }

  open(screen: () => MenuScreen): void {
    this.stack.push(screen);
    this.render();
  }

  back(): void {
    if (this.stack.length <= 1) {
      this.onExitRoot?.();
      return;
    }
    this.stack.pop();
    this.render();
  }

  destroy(): void {
    this.surface.clear();
    this.container.destroy();
  }

  render(): void {
    const t = theme();
    const { width } = this.scene.scale;
    const screen = this.stack[this.stack.length - 1]();
    const left = width / 2 - ROW_W / 2;
    const right = left + ROW_W;

    this.surface.begin();
    this.lastSpots = [];

    this.surface.text('title', width / 2, 150, screen.title, {
      fontFamily: t.font.display, fontSize: '26px', color: t.chrome.heading,
    }, [0.5, 0.5]);

    if (screen.subtitle) {
      this.surface.text('subtitle', width / 2, 178, screen.subtitle, {
        fontFamily: t.font.display, fontSize: '13px', color: t.chrome.dim,
      }, [0.5, 0.5]);
    }

    let y = TOP;

    for (const item of screen.items) {
      const enabled = item.enabled !== false;
      const kind = item.kind ?? 'action';

      if (kind === 'heading') {
        this.surface.text(`row.${item.id}`, left + 2, y + 14, item.label.toUpperCase(), {
          fontFamily: t.font.display, fontSize: '11px', color: t.chrome.dim,
        }, [0, 0.5]);
        y += 26;
        continue;
      }

      const label = `${item.label}${kind === 'submenu' ? '  ›' : ''}`;
      const colour = !enabled ? t.panel.dim
        : item.primary ? t.chrome.primary.text
        : t.chrome.text;
      const fill = item.primary ? t.chrome.primary.fill : hex(t.chrome.panel);

      // One button per row, spanning the width, so the whole row is the target
      // rather than the few pixels the text happens to cover.
      this.surface.button(`row.${item.id}`, left, y, {
        label,
        style: {
          fontFamily: t.font.display, fontSize: '17px', color: colour,
          backgroundColor: fill, padding: { x: 14, y: 7 }, fixedWidth: ROW_W,
        },
        hover: enabled
          ? { on: item.primary ? t.chrome.primary.hover : t.chrome.button.hover, off: fill }
          : undefined,
        onPress: () => { if (enabled) item.onPress?.(); },
      });

      const middle = y + BTN_H / 2;
      let nudge: { dec: number; inc: number } | null = null;

      if (item.value !== undefined) {
        const nudgeable = Boolean(item.onAdjust) && enabled;
        // ‹ [ value ] ›, right to left from the row's edge.
        const incX = right - PAD_R - NUDGE_W;
        const decX = incX - VALUE_W - NUDGE_W;

        this.surface.text(`val.${item.id}`, incX - 8, middle, item.value, {
          fontFamily: t.font.display, fontSize: '15px',
          color: enabled ? t.chrome.heading : t.panel.dim,
        }, [1, 0.5]);

        if (nudgeable) {
          nudge = { dec: decX + NUDGE_W / 2, inc: incX + NUDGE_W / 2 };
          for (const [key, delta, x] of [['dec', -1, decX], ['inc', 1, incX]] as const) {
            this.surface.button(`${key}.${item.id}`, x, middle, {
              label: delta < 0 ? '‹' : '›',
              style: {
                fontFamily: t.font.display, fontSize: '15px', color: t.chrome.text,
                backgroundColor: t.chrome.button.fill,
                padding: { x: 8, y: 3 }, fixedWidth: NUDGE_W, align: 'center',
              },
              hover: { on: t.chrome.button.hover, off: t.chrome.button.fill },
              onPress: () => item.onAdjust?.(delta as 1 | -1),
              origin: [0, 0.5],
            });
          }
        }
      }

      this.lastSpots.push({
        id: item.id, label: item.label,
        x: left + ROW_W / 2, y: middle, enabled,
        value: item.value ?? null,
        decX: nudge?.dec ?? null,
        incX: nudge?.inc ?? null,
      });

      y += ROW_H;

      // The note goes *under* the row it belongs to, and pushes the next one
      // down — a fixed pitch would draw it on top of the next background.
      const note = !enabled ? (item.reason ?? null) : (item.hint ?? null);
      if (note) {
        this.surface.text(`hint.${item.id}`, left + 16, y + 1, note, {
          fontFamily: t.font.body, fontSize: '10px',
          color: enabled ? t.chrome.dim : t.chrome.danger,
        }, [0, 0.5]);
        y += NOTE_H;
      }
    }

    this.surface.end();
  }
}

/** The row every screen but the root ends with. */
export function backItem(menu: Menu, label = 'Back'): MenuItem {
  return { id: 'back', label, kind: 'back', onPress: () => menu.back() };
}
