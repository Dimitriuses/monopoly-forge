import Phaser from 'phaser';
import { theme, type LogKind } from './Theme';

// ─── Notification / turn log ──────────────────────────────────────────────────
// The running commentary, in the column between the board (which ends at x=760)
// and the HUD (which starts at x=1055), under the property panel.
//
// This used to be a stack of toasts that appeared, drifted upward and vanished —
// centred under the board, directly on top of the ROLL DICE button. It is now a
// log: entries arrive at the top, push the older ones down, and fade with age
// instead of disappearing, so you can still read what happened two turns ago.
//
// Since it only ever showed the dozen entries that fit, anything older was
// destroyed and gone. The entries are **kept** now and the drawn strip is a
// *window* onto them: scroll the wheel over the log to look further back. That
// split — a list of what happened, and a view of part of it — is also why the
// history can be read by anything that wants it (`log`), rather than only by
// whoever was looking at the screen when it scrolled past.
//
// The `show(message, type)` signature is unchanged, because every call site in
// the game reports events through it and a second, parallel notification system
// would only fight this one for the same strip of screen.

export type NotifType = LogKind;

export interface LogEntry {
  message: string;
  type: NotifType;
}

const X = 770;              // aligned with the property panel above
const W = 270;
const TOP = 496;            // property panel ends at y=480
const BOTTOM = 786;
const GAP = 4;
const PAD = 6;

/** How far back the log remembers. A long game logs a few hundred lines. */
const MAX_HISTORY = 500;

export class Notification {
  private scene: Phaser.Scene;
  /** Everything that has happened, newest first. */
  private history: LogEntry[] = [];
  /** How many entries are scrolled past the top of the window. */
  private offset = 0;
  private drawn: Phaser.GameObjects.Container[] = [];
  private marker: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    const t = theme();
    scene.add.text(X + W / 2, TOP - 14, '📜 LOG', {
      fontFamily: t.font.display, fontSize: '9px', color: t.panel.subtitle,
    }).setOrigin(0.5, 0).setDepth(49);

    const rule = scene.add.graphics().setDepth(49);
    rule.lineStyle(1, t.panel.divider, 1);
    rule.lineBetween(X, TOP - 2, X + W, TOP - 2);

    // Only visible while scrolled back, so the log looks exactly as it did
    // until somebody goes looking.
    this.marker = scene.add.text(X + W / 2, TOP - 14, '', {
      fontFamily: t.font.display, fontSize: '9px', color: t.chrome.dim,
    }).setOrigin(0.5, 0).setDepth(51).setVisible(false);

    scene.input.on('wheel', (
      pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number,
    ) => {
      if (pointer.x < X || pointer.x > X + W) return;
      if (pointer.y < TOP || pointer.y > BOTTOM) return;
      this.scrollBy(dy > 0 ? 1 : -1);
    });
  }

  /**
   * The whole game as plain text, oldest first — the order somebody reading it
   * expects, which is the reverse of how it is drawn.
   */
  transcript(): string {
    return [...this.log].reverse()
      .map((entry) => `[${entry.type}] ${entry.message}`)
      .join('\n');
  }

  /** Everything logged, newest first. Read-only — `show` is the way in. */
  get log(): readonly LogEntry[] {
    return this.history;
  }

  /**
   * Add an entry. `duration` is accepted for compatibility with the old toast
   * API and ignored — entries live in the log for the rest of the game.
   */
  show(message: string, type: NotifType = 'info', _duration = 0): void {
    void _duration;

    this.history.unshift({ message, type });
    if (this.history.length > MAX_HISTORY) this.history.pop();

    // Somebody reading older entries should not have them slide out from under
    // the cursor every time the game says something, so a scrolled-back view
    // holds its place instead of following the newest line.
    if (this.offset > 0) this.offset = Math.min(this.offset + 1, this.history.length - 1);

    this.render(this.offset === 0);
  }

  /** Wheel over the log: back through the history, or forward to the newest. */
  private scrollBy(steps: number): void {
    const next = Phaser.Math.Clamp(this.offset + steps, 0, Math.max(0, this.history.length - 1));
    if (next === this.offset) return;
    this.offset = next;
    this.render(false);
  }

  // ─── Drawing ────────────────────────────────────────────────────────────────

  /**
   * Redraw the window. The whole strip is rebuilt rather than diffed: it is a
   * dozen entries, it happens once per logged event, and holding drawn objects
   * per entry is what made the old version lose anything that scrolled off.
   */
  private render(fadeInNewest: boolean): void {
    for (const container of this.drawn) {
      this.scene.tweens.killTweensOf(container);
      container.destroy();
    }
    this.drawn = [];

    const t = theme();
    let y = TOP;
    let shown = 0;

    for (const entry of this.history.slice(this.offset)) {
      const text = this.scene.add.text(PAD + 4, PAD, entry.message, {
        fontFamily: t.font.display, fontSize: '11px', color: t.log.text[entry.type],
        wordWrap: { width: W - PAD * 2 - 10 },
      });
      const height = Math.max(22, text.height + PAD * 2);

      if (y + height > BOTTOM) {
        text.destroy();
        break;
      }

      const bg = this.scene.add.graphics();
      bg.fillStyle(t.log.background, 1);
      bg.fillRoundedRect(0, 0, W, height, 4);
      bg.fillStyle(t.log.accent[entry.type], 1);
      bg.fillRect(0, 0, 3, height);   // accent stripe carries the type

      // Older entries dim, so the newest reads first without being loud.
      const container = this.scene.add.container(X, y, [bg, text])
        .setDepth(50)
        .setAlpha(Math.max(0.35, 1 - shown * 0.12));

      if (shown === 0 && fadeInNewest) {
        container.setAlpha(0);
        this.scene.tweens.add({
          targets: container, alpha: 1, duration: 180, ease: 'Sine.easeOut',
        });
      }

      this.drawn.push(container);
      y += height + GAP;
      shown++;
    }

    const older = Math.max(0, this.history.length - this.offset - shown);
    this.marker
      .setVisible(this.offset > 0)
      .setText(this.offset > 0 ? `▲ ${this.offset} newer · ${older} older ▼` : '');
  }
}
