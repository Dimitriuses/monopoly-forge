import Phaser from 'phaser';

// Pip positions as [col, row] on a 3×3 grid, normalised 0–1
const PIP_LAYOUTS: [number, number][][] = [
  [],                                                        // 0 (unused)
  [[1, 1]],                                                  // 1 – centre
  [[0, 0], [2, 2]],                                          // 2
  [[0, 0], [1, 1], [2, 2]],                                  // 3
  [[0, 0], [2, 0], [0, 2], [2, 2]],                          // 4
  [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],                  // 5
  [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],          // 6
];

export class DiceView {
  private scene: Phaser.Scene;
  private g: Phaser.GameObjects.Graphics;
  private x: number;
  private y: number;
  private size: number;          // face side-length in px
  private die1: number = 1;
  private die2: number = 1;
  private animTimer?: Phaser.Time.TimerEvent;
  private frameCount = 0;
  private targetDie1 = 1;
  private targetDie2 = 1;
  private onSettled?: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, size = 44) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.size = size;
    this.g = scene.add.graphics();
    this.draw(1, 1, false);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Kick off roll animation, settle on (die1, die2) after ~700ms */
  roll(die1: number, die2: number, onSettled?: () => void): void {
    this.targetDie1 = die1;
    this.targetDie2 = die2;
    this.onSettled = onSettled;
    this.frameCount = 0;

    if (this.animTimer) this.animTimer.remove();

    this.animTimer = this.scene.time.addEvent({
      delay: 60,
      repeat: 11,
      callback: this.onAnimFrame,
      callbackScope: this,
    });
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.draw(this.die1, this.die2, false);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private onAnimFrame(): void {
    this.frameCount++;
    const settling = this.frameCount > 9;

    const d1 = settling ? this.targetDie1 : Phaser.Math.Between(1, 6);
    const d2 = settling ? this.targetDie2 : Phaser.Math.Between(1, 6);

    this.draw(d1, d2, settling && this.frameCount === 12);

    if (this.frameCount === 12) {
      this.die1 = this.targetDie1;
      this.die2 = this.targetDie2;
      this.onSettled?.();
    }
  }

  private draw(d1: number, d2: number, isDoubles: boolean): void {
    this.g.clear();

    const gap = 12;
    const totalW = this.size * 2 + gap;
    const startX = this.x - totalW / 2;

    this.drawFace(startX,             this.y, d1, isDoubles);
    this.drawFace(startX + this.size + gap, this.y, d2, isDoubles);
  }

  private drawFace(x: number, y: number, value: number, highlight: boolean): void {
    const s = this.size;
    const r = 6;

    // Shadow
    this.g.fillStyle(0x000000, 0.25);
    this.g.fillRoundedRect(x + 2, y + 2, s, s, r);

    // Face
    this.g.fillStyle(highlight ? 0xfffbe6 : 0xffffff, 1);
    this.g.fillRoundedRect(x, y, s, s, r);

    // Border
    this.g.lineStyle(1.5, highlight ? 0xd4a800 : 0xbbbbbb, 1);
    this.g.strokeRoundedRect(x, y, s, s, r);

    // Pips
    const pips = PIP_LAYOUTS[value] ?? [];
    const padding = 7;
    const cell = (s - padding * 2) / 3;  // 3 columns/rows in the pip grid
    const pr = 3.5;

    this.g.fillStyle(0x222222, 1);
    for (const [col, row] of pips) {
      const px = x + padding + col * cell + cell / 2;
      const py = y + padding + row * cell + cell / 2;
      this.g.fillCircle(px, py, pr);
    }
  }
}
