import Phaser from 'phaser';

// ─── AuctionPanel ─────────────────────────────────────────────────────────────
// The bidding modal. Like PropertyPanel it renders a view model and reports
// presses; the Auction class in game/ owns the rules. The one thing it does own
// is the clock: each bidder gets a countdown, and running it out is a pass —
// which is why the timer lives next to the buttons rather than in the model.

export interface AuctionView {
  tileName: string;
  subtitle: string;
  groupColor: number | null;
  /** Face price of the deed, shown as a yardstick for the bidding. */
  price: number;
  bidderName: string;
  bidderColor: number;
  bidderCash: number;
  highBid: number;
  highBidderName: string | null;
  /** Bid amounts to offer; any the bidder cannot cover are drawn dead. */
  options: number[];
  /** Everyone still in the running, in seat order. */
  remaining: string[];
  secondsPerBid: number;
}

const W = 420;
const H = 280;

export class AuctionPanel {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private onBid: (amount: number) => void;
  private onPass: () => void;
  private timer: Phaser.Time.TimerEvent | null = null;
  private clockBar: Phaser.GameObjects.Rectangle | null = null;

  constructor(
    scene: Phaser.Scene,
    onBid: (amount: number) => void,
    onPass: () => void,
  ) {
    this.scene     = scene;
    this.onBid     = onBid;
    this.onPass    = onPass;
    this.container = scene.add.container(512, 400).setDepth(45).setVisible(false);
  }

  get isOpen(): boolean { return this.container.visible; }

  // No render memo here, unlike PropertyPanel and TradePanel: show() also restarts
  // the bid clock, so skipping a redraw would silently skip a bidder's timer. It
  // is only ever called when the auction state has actually moved on anyway.

  hide(): void {
    this.stopClock();
    this.container.setVisible(false);
  }

  show(view: AuctionView): void {
    this.stopClock();
    this.container.removeAll(true);

    const parts: Phaser.GameObjects.GameObject[] = [];
    const frame = this.scene.add.graphics();
    // Opaque: at 0.98 the board's centrepiece emoji glows faintly through it.
    frame.fillStyle(0x0d1b35, 1);
    frame.fillRoundedRect(-W / 2, -H / 2, W, H, 8);
    frame.lineStyle(2, 0xf0c040, 1);
    frame.strokeRoundedRect(-W / 2, -H / 2, W, H, 8);
    if (view.groupColor !== null) {
      frame.fillStyle(view.groupColor, 1);
      frame.fillRect(-W / 2 + 2, -H / 2 + 2, W - 4, 7);
    }
    parts.push(frame);

    parts.push(this.scene.add.text(0, -H / 2 + 16, '🔨  AUCTION', {
      fontFamily: 'Georgia, serif', fontSize: '13px', color: '#f0c040', fontStyle: 'bold',
    }).setOrigin(0.5, 0));

    parts.push(this.scene.add.text(0, -H / 2 + 36, view.tileName, {
      fontFamily: 'Georgia, serif', fontSize: '20px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5, 0));

    parts.push(this.scene.add.text(0, -H / 2 + 60, `${view.subtitle}   ·   list price $${view.price}`, {
      fontFamily: 'Georgia, serif', fontSize: '11px', color: '#7788aa',
    }).setOrigin(0.5, 0));

    // ── Standing bid ──────────────────────────────────────────────────────────
    const standing = view.highBidderName
      ? `${view.highBidderName} leads at $${view.highBid}`
      : 'No bids yet';
    parts.push(this.scene.add.text(0, -H / 2 + 84, standing, {
      fontFamily: 'Georgia, serif', fontSize: '14px',
      color: view.highBidderName ? '#88ff88' : '#8899aa',
    }).setOrigin(0.5, 0));

    // ── Whose turn ────────────────────────────────────────────────────────────
    parts.push(this.scene.add.circle(-96, -H / 2 + 118, 7, view.bidderColor)
      .setStrokeStyle(1, 0xffffff));
    parts.push(this.scene.add.text(-82, -H / 2 + 110,
      `${view.bidderName} to bid   ·   $${view.bidderCash.toLocaleString()} in hand`, {
        fontFamily: 'Georgia, serif', fontSize: '13px', color: '#ddeeff',
      }));

    // ── Clock ─────────────────────────────────────────────────────────────────
    parts.push(this.scene.add.rectangle(-W / 2 + 20, -H / 2 + 136, W - 40, 4, 0x1e3454)
      .setOrigin(0, 0));
    this.clockBar = this.scene.add.rectangle(-W / 2 + 20, -H / 2 + 136, W - 40, 4, 0xf0c040)
      .setOrigin(0, 0);
    parts.push(this.clockBar);

    // ── Bid buttons ───────────────────────────────────────────────────────────
    view.options.forEach((amount, i) => {
      const affordable = amount <= view.bidderCash;
      const bg  = affordable ? '#1a6b35' : '#2c3542';
      // Three 120px buttons with 10px gutters exactly fill the frame's inner
      // width (420 - 2×20); anything wider spills over the border.
      const btn = this.scene.add.text(-W / 2 + 20 + i * 130, 26, `Bid $${amount}`, {
        fontFamily: 'Georgia, serif', fontSize: '14px',
        color: affordable ? '#ffffff' : '#5a6478',
        backgroundColor: bg, padding: { x: 10, y: 9 },
        fixedWidth: 120, align: 'center',
      }).setOrigin(0, 0.5);

      if (affordable) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#27ae60' }));
        btn.on('pointerout',  () => btn.setStyle({ backgroundColor: bg }));
        btn.on('pointerdown', () => { this.stopClock(); this.onBid(amount); });
      }
      parts.push(btn);
    });

    const pass = this.scene.add.text(0, 84, '❌  PASS — and you are out', {
      fontFamily: 'Georgia, serif', fontSize: '14px', color: '#ffffff',
      backgroundColor: '#6b1e1e', padding: { x: 18, y: 9 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    pass.on('pointerover', () => pass.setStyle({ backgroundColor: '#922b21' }));
    pass.on('pointerout',  () => pass.setStyle({ backgroundColor: '#6b1e1e' }));
    pass.on('pointerdown', () => { this.stopClock(); this.onPass(); });
    parts.push(pass);

    parts.push(this.scene.add.text(0, H / 2 - 22, `Still bidding: ${view.remaining.join(', ')}`, {
      fontFamily: 'Georgia, serif', fontSize: '10px', color: '#55667a',
      wordWrap: { width: W - 40 }, align: 'center',
    }).setOrigin(0.5, 0));

    this.container.add(parts);
    this.container.setVisible(true);
    this.startClock(view.secondsPerBid);
  }

  // ── Clock ───────────────────────────────────────────────────────────────────

  private startClock(seconds: number): void {
    const bar = this.clockBar;
    if (!bar || seconds <= 0) return;
    const full = bar.width;

    this.timer = this.scene.time.addEvent({
      delay: 100,
      repeat: seconds * 10,
      callback: () => {
        const left = 1 - (this.timer?.getOverallProgress() ?? 1);
        bar.width = full * left;
        bar.fillColor = left < 0.3 ? 0xe74c3c : 0xf0c040;
        // Running the clock out is a pass — the rule that keeps a hot-seat
        // auction from stalling on a player who has walked away.
        if (left <= 0) { this.stopClock(); this.onPass(); }
      },
    });
  }

  private stopClock(): void {
    this.timer?.remove();
    this.timer = null;
  }
}
