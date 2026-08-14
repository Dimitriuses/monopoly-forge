import Phaser from 'phaser';
import type { TokenType } from '@/config';
import { TOKEN_LABELS } from '@/config';
import { SaveLoad, type SlotSummary } from '@/utils/SaveLoad';
import { GAMES, DEFAULT_GAME, rulesFor } from '@/games';
import { validateSnapshot, type GameSnapshot } from '@/game/Snapshot';
import {
  RULE_FIELDS, RULE_GROUPS, formatRuleValue, nudgeRuleValue, variantFields,
  type RuleGroup,
} from '@/game/RuleFields';
import type { GameRules } from '@/game/Rules';
import { theme, setTheme, knownThemes } from '@/ui/Theme';
import { bakeTokenTextures, bakeBuildingTextures } from '@/ui/Textures';
import { Menu, backItem, type MenuItem, type MenuScreen } from '@/ui/Menu';
import { sfx } from '@/ui/Sfx';

interface PlayerSetup {
  name: string;
  token: TokenType;
  isBot: boolean;
}

// ─── MenuScene ────────────────────────────────────────────────────────────────
// Play / Load / Settings, as a tree.
//
// It was one flat screen with everything on it, which held six games, five
// player counts, six seat rows and four switches and had run out of room — the
// house-rule chips were already shrinking to fit as more variants registered.
//
// The important change is not the nesting, it is **`overrides`**. The menu used
// to keep a whole `HouseRules` object plus three "has the player touched this?"
// flags, because a game's defaults must not beat a player's choice and a
// player's choice must not beat a game they have not chosen yet. Keeping only
// the keys somebody actually changed makes that bookkeeping disappear: layering
// is `rulesFor(game, overrides)`, which is what the engine does anyway, and the
// bug Pocket hit in M9b — the menu's `false` beating a game's `true` — cannot be
// written any more.

export class MenuScene extends Phaser.Scene {
  private menu!: Menu;
  private playerCount = 2;
  private players: PlayerSetup[] = [];

  /**
   * Only the rules the player has changed. Everything else comes from the game,
   * so picking a different game moves every untouched value with it and leaves
   * every deliberate one alone.
   */
  private overrides: Partial<GameRules> = {};
  /** Whether a palette was picked by hand, which outranks a game's preference. */
  private themeChosen = false;
  private gameId: string = DEFAULT_GAME.id;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const t = theme();

    this.add.rectangle(0, 0, width, height, t.chrome.page).setOrigin(0);
    this.add.text(width / 2, 70, '🏦 MONOPOLY FORGE', {
      fontFamily: t.font.display, fontSize: '40px', color: t.chrome.heading,
      stroke: '#000', strokeThickness: 4,
    }).setOrigin(0.5);
    this.add.text(width / 2, 110, 'A Custom Phaser 3 Edition', {
      fontFamily: t.font.display, fontSize: '16px', color: t.chrome.dim,
    }).setOrigin(0.5);

    this.readUrl();
    this.seatDefaults();

    this.menu = new Menu(this, () => this.rootScreen());
    this.menu.render();
    this.exposeMenuHandle();
  }

  // ── The screens ─────────────────────────────────────────────────────────────

  private rootScreen(): MenuScreen {
    const recent = SaveLoad.mostRecent();
    return {
      title: 'Main Menu',
      items: [
        { id: 'play', label: 'Play', kind: 'submenu', primary: true,
          onPress: () => this.menu.open(() => this.playScreen()) },
        { id: 'load', label: 'Load', kind: 'submenu',
          value: recent ? `slot ${recent.slot}` : 'empty',
          enabled: recent !== null,
          reason: 'No saved games yet',
          onPress: () => this.menu.open(() => this.loadScreen()) },
        { id: 'settings', label: 'Settings', kind: 'submenu',
          onPress: () => this.menu.open(() => this.settingsScreen()) },
      ],
    };
  }

  private playScreen(): MenuScreen {
    const game = GAMES[this.gameId];
    const items: MenuItem[] = [
      { id: 'game', label: 'Game', kind: 'value', value: game.name, hint: game.blurb,
        onAdjust: (d) => { this.cycleGame(d); this.menu.render(); } },
      { id: 'rules', label: 'Game Settings', kind: 'submenu',
        value: this.changedCount() ? `${this.changedCount()} changed` : 'default',
        onPress: () => this.menu.open(() => this.rulesScreen()) },
      { id: 'count', label: 'Number of Players', kind: 'value', value: String(this.playerCount),
        onAdjust: (d) => { this.setPlayerCount(this.playerCount + d); this.menu.render(); } },
      { id: 'seats', label: 'Players', kind: 'heading' },
    ];

    this.players.forEach((player, i) => {
      items.push({
        id: `seat${i + 1}`,
        label: `${player.name} — ${TOKEN_LABELS[player.token]}`,
        kind: 'value',
        value: player.isBot ? '🤖 Bot' : '🙋 Human',
        onPress: () => { this.cycleToken(i); this.menu.render(); },
        onAdjust: () => { player.isBot = !player.isBot; this.menu.render(); },
      });
    });

    items.push(
      { id: 'start', label: 'Start', primary: true, onPress: () => this.startGame() },
      { id: 'cancel', label: 'Cancel', onPress: () => this.menu.back() },
    );
    return { title: 'Play', items };
  }

  /**
   * Sections, not one long list. Twenty rules plus the variants overflow a
   * screen, and a menu that scrolls is a menu whose rows the harness has to
   * scroll into view first — this is both the smaller change and the better
   * read. Which section a rule is in is metadata beside the rule, so a rule
   * added to the engine still costs one line and no scene edit.
   */
  private rulesScreen(): MenuScreen {
    const game = GAMES[this.gameId];
    const items: MenuItem[] = RULE_GROUPS.map((group) => {
      const changed = RULE_FIELDS
        .filter((f) => f.group === group.id && f.key in this.overrides).length;
      return {
        id: `group.${group.id}`,
        label: group.label,
        kind: 'submenu' as const,
        value: changed ? `${changed} changed` : undefined,
        onPress: () => this.menu.open(() => this.ruleGroupScreen(group.id, group.label)),
      };
    });

    items.push({
      id: 'group.variants', label: 'Variants', kind: 'submenu',
      value: rulesFor(game, this.overrides).variants.length
        ? `${rulesFor(game, this.overrides).variants.length} on` : undefined,
      onPress: () => this.menu.open(() => this.variantsScreen()),
    });

    items.push(
      { id: 'reset', label: 'Reset to game defaults',
        enabled: this.changedCount() > 0,
        reason: `Nothing changed — these are ${game.name}'s own rules`,
        onPress: () => { this.overrides = {}; this.menu.render(); } },
      backItem(this.menu),
    );

    return {
      title: 'Game Settings',
      subtitle: this.changedCount()
        ? `${game.name}, with ${this.changedCount()} rule${this.changedCount() === 1 ? '' : 's'} changed`
        : `${game.name}'s own rules`,
      items,
    };
  }

  private ruleGroupScreen(group: RuleGroup, label: string): MenuScreen {
    const game = GAMES[this.gameId];
    const resolved = rulesFor(game, this.overrides);
    const defaults = rulesFor(game);

    const items: MenuItem[] = RULE_FIELDS.filter((f) => f.group === group).map((field) => ({
      id: `rule.${field.key}`,
      label: field.label,
      kind: 'value' as const,
      value: formatRuleValue(field, resolved[field.key]),
      // A changed rule says so, so "what have I actually altered?" is answerable
      // without remembering what this game's default was.
      hint: field.key in this.overrides
        ? `changed — ${game.name} plays ${formatRuleValue(field, defaults[field.key])}`
        : field.hint,
      onAdjust: (d) => {
        this.overrides = {
          ...this.overrides,
          [field.key]: nudgeRuleValue(field, resolved[field.key], d),
        };
        this.menu.render();
      },
    }));

    items.push(backItem(this.menu));
    return { title: label, subtitle: `Playing ${game.name}`, items };
  }

  private variantsScreen(): MenuScreen {
    const on = rulesFor(GAMES[this.gameId], this.overrides).variants;
    const items: MenuItem[] = variantFields().map((variant) => ({
      id: `variant.${variant.name}`,
      label: variant.label,
      kind: 'value' as const,
      value: on.includes(variant.name) ? 'on' : 'off',
      hint: variant.blurb,
      onPress: () => { this.toggleVariant(variant.name); this.menu.render(); },
      onAdjust: () => { this.toggleVariant(variant.name); this.menu.render(); },
    }));
    items.push(backItem(this.menu));
    return { title: 'Variants', items };
  }

  private loadScreen(): MenuScreen {
    const items: MenuItem[] = SaveLoad.slots().map((slot) => ({
      id: `slot${slot.slot}`,
      label: `Slot ${slot.slot}`,
      kind: 'value' as const,
      value: slot.used ? describeSlot(slot) : 'empty',
      hint: slot.used ? new Date(slot.timestamp).toLocaleString() : undefined,
      enabled: slot.used,
      reason: 'Nothing saved here',
      onPress: () => this.loadSlot(slot.slot),
    }));
    items.push(backItem(this.menu));
    return { title: 'Load', items };
  }

  private settingsScreen(): MenuScreen {
    return {
      title: 'Settings',
      items: [
        { id: 'sound', label: 'Sound', kind: 'value',
          value: sfx.muted ? 'off' : `${Math.round(sfx.volume * 100)}%`,
          onAdjust: (d) => { sfx.setVolume(sfx.volume + d * 0.1); this.menu.render(); },
          onPress: () => { sfx.toggleMute(); this.menu.render(); } },
        { id: 'theme', label: 'Theme', kind: 'value', value: theme().name,
          hint: 'A palette is a preference — it is not saved with a game',
          onAdjust: (d) => { this.cycleTheme(d); this.menu.render(); } },
        backItem(this.menu),
      ],
    };
  }

  // ── Choices ─────────────────────────────────────────────────────────────────

  private changedCount(): number {
    return Object.keys(this.overrides).length;
  }

  private cycleGame(delta: 1 | -1): void {
    const ids = Object.keys(GAMES);
    const at = ids.indexOf(this.gameId);
    this.selectGame(ids[((at < 0 ? 0 : at) + delta + ids.length) % ids.length]);
  }

  /**
   * Take a game's palette. Its *rules* need nothing done to them — they are the
   * base `rulesFor` layers the overrides over, so an untouched rule follows the
   * game automatically and a changed one stays changed.
   */
  private selectGame(id: string): void {
    this.gameId = id;
    const game = GAMES[id];
    if (game?.theme && !this.themeChosen) this.applyTheme(game.theme);
  }

  private toggleVariant(name: string): void {
    const current = rulesFor(GAMES[this.gameId], this.overrides).variants;
    this.overrides = {
      ...this.overrides,
      variants: current.includes(name)
        ? current.filter((v) => v !== name)
        : [...current, name],
    };
  }

  private cycleTheme(delta: 1 | -1): void {
    const ids = knownThemes().map((t) => t.id);
    const at = ids.indexOf(theme().id);
    this.themeChosen = true;
    this.applyTheme(ids[((at < 0 ? 0 : at) + delta + ids.length) % ids.length]);
  }

  /**
   * Switch palette. The pieces and the buildings are baked textures, so a new one
   * means baking them again.
   */
  private applyTheme(id: string): void {
    setTheme(id);
    bakeTokenTextures(this);
    bakeBuildingTextures(this);
    this.cameras.main.setBackgroundColor(theme().chrome.page);
  }

  private setPlayerCount(count: number): void {
    this.playerCount = Math.max(2, Math.min(6, count));
    this.seatDefaults();
  }

  private seatDefaults(): void {
    const tokens = Object.keys(TOKEN_LABELS) as TokenType[];
    const kept = this.players.slice(0, this.playerCount);
    for (let i = kept.length; i < this.playerCount; i++) {
      // Seat 1 is yours; the rest default to bots, so one person can start a real
      // game without configuring anything.
      kept.push({ name: `Player ${i + 1}`, token: tokens[i % tokens.length], isBot: i > 0 });
    }
    this.players = kept;
  }

  /**
   * The next piece nobody else has taken. Cycling each row independently used to
   * let two seats both end up as "Car", and a shared token is a shared colour on
   * the board — there is then nothing left to tell the two players apart by.
   */
  private cycleToken(seat: number): void {
    const tokens = Object.keys(TOKEN_LABELS) as TokenType[];
    const taken = new Set(this.players.filter((_, i) => i !== seat).map((p) => p.token));
    const from = tokens.indexOf(this.players[seat].token);
    for (let step = 1; step <= tokens.length; step++) {
      const candidate = tokens[(from + step) % tokens.length];
      if (!taken.has(candidate)) { this.players[seat].token = candidate; return; }
    }
  }

  // ── Starting ────────────────────────────────────────────────────────────────

  private loadSlot(slot: number): void {
    const saved = SaveLoad.load(slot);
    if (!saved || !validateSnapshot(saved.state)) return;
    this.scene.start('GameScene', {
      players: this.players,
      snapshot: saved.state as unknown as GameSnapshot,
    });
  }

  private startGame(): void {
    this.scene.start('GameScene', {
      players: this.players,
      seed: this.readSeedFromUrl(),
      gameId: this.gameId,
      houseRules: { ...this.overrides },
    });
  }

  // ── The URL ─────────────────────────────────────────────────────────────────
  // Still the only way a harness can drive the menu: it is canvas text with no
  // DOM to click, and every switch that was reachable before this rewrite stays
  // reachable. A rule named here counts as *chosen*, exactly as clicking it does.

  private readUrl(): void {
    const params = new URLSearchParams(window.location.search);

    const asked = params.get('game');
    if (asked && GAMES[asked]) this.gameId = asked;

    const themeId = params.get('theme');
    if (themeId) this.themeChosen = true;
    this.selectGame(this.gameId);
    if (themeId) this.applyTheme(themeId);

    for (const key of params.get('houseRules')?.split(',') ?? []) {
      if (RULE_FIELDS.some((f) => f.key === key)) {
        this.overrides = { ...this.overrides, [key]: true };
      }
    }

    const variants = params.get('variants');
    if (variants !== null) {
      this.overrides = {
        ...this.overrides,
        variants: variants.split(',').filter(Boolean),
      };
    }

    const players = Number(params.get('players'));
    if (Number.isFinite(players) && players >= 2) this.setPlayerCount(players);
  }

  /**
   * `?seed=12345` re-seeds the global PRNG, so dice rolls and both card shuffles
   * replay identically. Omitted or non-numeric = a random game.
   */
  private readSeedFromUrl(): number | undefined {
    const raw = new URLSearchParams(window.location.search).get('seed');
    if (raw === null || raw.trim() === '') return undefined;
    const seed = Number(raw);
    return Number.isFinite(seed) ? seed : undefined;
  }

  /**
   * Where the rows are, by name. The harness used to hold menu coordinates in
   * `HOTSPOTS`, which a nested menu invalidates completely — this is the same
   * answer `tileCentre()` and `tradeSpots()` already gave: a thing that decides
   * its own layout reports it.
   */
  private exposeMenuHandle(): void {
    (window as unknown as Record<string, unknown>).__menu = {
      title: () => this.menu.title,
      depth: () => this.menu.depth,
      spots: () => this.menu.spots(),
      back: () => { this.menu.back(); },
    };
  }
}

function describeSlot(slot: SlotSummary): string {
  const name = GAMES[slot.gameId]?.name ?? slot.gameId ?? 'game';
  return slot.round ? `${name}, round ${slot.round}` : name;
}
