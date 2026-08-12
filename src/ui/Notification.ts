import Phaser from 'phaser';

// ─── Notification / turn log ──────────────────────────────────────────────────
// The running commentary, in the column between the board (which ends at x=760)
// and the HUD (which starts at x=1055), under the property panel.
//
// This used to be a stack of toasts that appeared, drifted upward and vanished —
// centred under the board, directly on top of the ROLL DICE button. It is now a
// log: entries arrive at the top, push the older ones down, and fade with age
// instead of disappearing, so you can still read what happened two turns ago.
//
// The `show(message, type)` signature is unchanged, because every call site in
// the game reports events through it and a second, parallel notification system
// would only fight this one for the same strip of screen.

export type NotifType = 'info' | 'success' | 'warning' | 'danger';

const ACCENTS: Record<NotifType, number> = {
  info:    0x5577cc,
  success: 0x2ecc71,
  warning: 0xf0c040,
  danger:  0xe74c3c,
};

const TEXT: Record<NotifType, string> = {
  info:    '#c8d6e8',
  success: '#a9f0c1',
  warning: '#f5dfa0',
  danger:  '#f3b0a8',
};

const X = 770;              // aligned with the property panel above
const W = 270;
const TOP = 496;            // property panel ends at y=480
const BOTTOM = 786;
const GAP = 4;
const PAD = 6;

interface Entry {
  message: string;
  type: NotifType;
  container: Phaser.GameObjects.Container;
  height: number;
}

export class Notification {
  private scene: Phaser.Scene;
  private entries: Entry[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    scene.add.text(X + W / 2, TOP - 14, '📜 LOG', {
      fontFamily: 'Georgia, serif', fontSize: '9px', color: '#2a3a55',
    }).setOrigin(0.5, 0).setDepth(49);

    const rule = scene.add.graphics().setDepth(49);
    rule.lineStyle(1, 0x2a3a55, 1);
    rule.lineBetween(X, TOP - 2, X + W, TOP - 2);
  }

  /**
   * Add an entry. `duration` is accepted for compatibility with the old toast
   * API and ignored — entries live until they are pushed off the bottom.
   */
  show(message: string, type: NotifType = 'info', _duration = 0): void {
    void _duration;

    const text = this.scene.add.text(PAD + 4, PAD, message, {
      fontFamily: 'Georgia, serif', fontSize: '11px', color: TEXT[type],
      wordWrap: { width: W - PAD * 2 - 10 },
    });
    const height = Math.max(22, text.height + PAD * 2);

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x121c30, 1);
    bg.fillRoundedRect(0, 0, W, height, 4);
    bg.fillStyle(ACCENTS[type], 1);
    bg.fillRect(0, 0, 3, height);   // accent stripe carries the type

    const container = this.scene.add.container(X, TOP, [bg, text])
      .setDepth(50).setAlpha(0);

    this.entries.unshift({ message, type, container, height });
    this.layout();

    this.scene.tweens.add({
      targets: container, alpha: 1, duration: 180, ease: 'Sine.easeOut',
    });
  }

  /** Newest at the top; anything pushed past the bottom edge is dropped. */
  private layout(): void {
    let y = TOP;
    const kept: Entry[] = [];

    for (const entry of this.entries) {
      if (y + entry.height > BOTTOM) {
        entry.container.destroy();
        continue;
      }
      // Older entries dim, so the newest reads first without being loud.
      const age = kept.length;
      entry.container.setAlpha(entry.container.alpha === 0 ? 0 : Math.max(0.35, 1 - age * 0.12));
      this.scene.tweens.add({
        targets: entry.container, y, duration: 160, ease: 'Sine.easeOut',
      });
      y += entry.height + GAP;
      kept.push(entry);
    }

    this.entries = kept;
  }
}
