import Phaser from 'phaser';
import { theme } from './Theme';
import type { TokenType } from '@/config';

// ─── Textures ─────────────────────────────────────────────────────────────────
// The pieces and the buildings, drawn at runtime rather than shipped as art —
// the repo carries no third-party assets and this keeps that true.
//
// It lives here rather than in `BootScene` because a theme repaints them. They
// are baked once at boot for whatever theme the URL asked for, and again when a
// game starts, in case the menu chose a different one. Re-baking is eight small
// render textures; measuring it would cost more than doing it.
//
// A game may bring its own artwork for any of these keys (`Game.assets`). Those
// are loaded before `create` and must survive a re-bake, which is what `supplied`
// is for — baking over a game's house with a drawn one would undo the loader's
// work the moment somebody changed theme.

/** Nothing supplied — the default, and the case that keeps the repo art-free. */
const EMPTY: ReadonlySet<string> = new Set();

const EMBLEMS: Record<TokenType, string> = {
  topHat: '🎩', car: '🚗', dog: '🐕', battleship: '🚢',
  iron: '🔩', boot: '👢', wheelbarrow: '🛒', thimble: '🧵',
};

/**
 * A disc in the player's colour with the token's own emblem baked in, so the
 * eight pieces are told apart by shape as well as by colour.
 *
 * `make.graphics` takes `addToScene` as its second argument; passing
 * `{ add: false }` inside the config still works at runtime but no longer
 * type-checks against Phaser 3.87's `Graphics.Options`.
 */
export function bakeTokenTextures(scene: Phaser.Scene, supplied: ReadonlySet<string> = EMPTY): void {
  const t = theme();

  for (const [name, emblem] of Object.entries(EMBLEMS) as Array<[TokenType, string]>) {
    const key = `token_${name}`;
    if (supplied.has(key)) continue;   // the game brought a picture for this one
    // Baked before under another theme: the old texture has to go first, or
    // `saveTexture` finds the key taken and the piece keeps the old colour.
    if (scene.textures.exists(key)) scene.textures.remove(key);

    const g = scene.make.graphics({}, false);
    g.fillStyle(t.tokens[name], 1);
    g.fillCircle(16, 16, 14);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeCircle(16, 16, 14);

    const text = scene.make.text({
      text: emblem,
      style: { fontFamily: t.font.body, fontSize: '15px' },
    }, false).setOrigin(0.5);

    const rt = scene.make.renderTexture({ width: 32, height: 32 }, false);
    rt.draw(g);
    rt.draw(text, 16, 17);
    rt.saveTexture(key);   // the RT stays alive as the texture

    g.destroy();
    text.destroy();
  }
}

/** The house and hotel drawn along a lot's colour stripe. */
export function bakeBuildingTextures(scene: Phaser.Scene, supplied: ReadonlySet<string> = EMPTY): void {
  const t = theme();

  for (const [key, color, w, h, roof] of [
    ['house', t.groups.green,   20, 18, 10],
    ['hotel', t.groups.red,     26, 20, 13],
  ] as Array<[string, number, number, number, number]>) {
    if (supplied.has(key)) continue;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const g = scene.make.graphics({}, false);
    g.fillStyle(color, 1);
    g.fillRect(2, 6, w - 4, h - 6);
    g.fillTriangle(0, 6, roof, 0, w, 6);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
