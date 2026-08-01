// ─── Playtest harness ─────────────────────────────────────────────────────────
// Serves the production build, drives the real canvas with Playwright, plays a
// seeded game, and fails on any console error or page exception.
//
//   node tools/playtest.mjs              smoke test (used by CI)
//   node tools/playtest.mjs --shots      also write screenshots/ PNGs
//   node tools/playtest.mjs --turns 40   play more turns
//   node tools/playtest.mjs --headed     watch it play
//   node tools/playtest.mjs --url <url>  drive a deployed site instead of dist/
//
// The game is a single canvas with no DOM controls, so every interaction is a
// click at a board coordinate. Those coordinates are listed in HOTSPOTS below
// and must be kept in step with the scenes that draw the buttons.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'screenshots');

// ─── Args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const TAKE_SHOTS = flag('shots');
const HEADED = flag('headed');
const TURNS = Number(value('turns', TAKE_SHOTS ? 26 : 30));
const SEED = Number(value('seed', 20260512));
const EXTERNAL_URL = value('url', null);

// The Phaser canvas is a fixed 1280×800 with no scale manager, so game
// coordinates map 1:1 onto canvas pixels.
const GAME_W = 1280;
const GAME_H = 800;

const HOTSPOTS = {
  playerCount3: [590, 235],  // MenuScene: [2,3,4,5,6] at width/2-100 + i*50
  startGame:    [640, 720],  // MenuScene: (width/2, height-80)
  roll:         [512, 738],  // GameScene.buildButtons
  jail:         [710, 738],  // GameScene.buildButtons (hidden unless offered)
  buy:          [424, 458],  // GameScene.showBuyPrompt, container at (512,400)
  pass:         [600, 458],
  cardOk:       [640, 490],  // CardScene: (width/2, height/2 + 90)
};

// ─── Static file server for dist/ ─────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveDist() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const file = path.join(DIST, rel);
      // Refuse to serve anything outside dist/.
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickGame(page, canvasBox, [gx, gy]) {
  await page.mouse.click(canvasBox.x + gx, canvasBox.y + gy);
}

/** Poll a predicate evaluated in the page until it holds, or time out. */
async function waitFor(page, fn, { timeout = 8000, interval = 60 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(fn)) return true;
    await sleep(interval);
  }
  return false;
}

const forgeReady = () => typeof window.__forge !== 'undefined';
const idle = () => window.__forge && !window.__forge.isAnimating();

async function shot(page, canvasBox, name) {
  if (!TAKE_SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, clip: canvasBox });
  console.log(`   📸 screenshots/${name}.png`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!EXTERNAL_URL && !existsSync(path.join(DIST, 'index.html'))) {
    console.error('✗ dist/index.html not found — run `npm run build` first.');
    process.exit(1);
  }

  let server = null;
  let baseUrl = EXTERNAL_URL;
  if (!baseUrl) {
    const started = await serveDist();
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}/`;
  }

  const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}debug=1&seed=${SEED}`;
  console.log(`▶ playtest: ${url}`);
  console.log(`  ${TURNS} turns, seed ${SEED}${TAKE_SHOTS ? ', capturing screenshots' : ''}`);

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: GAME_W + 80, height: GAME_H + 60 } });

  // Any console error or uncaught exception fails the run.
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    errors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText})`);
  });

  let failure = null;
  try {
    await page.goto(url, { waitUntil: 'load' });

    const canvas = await page.waitForSelector('canvas', { timeout: 15000 });
    // Phaser boots through BootScene into MenuScene on the next frame.
    await sleep(900);
    let box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');
    box = { x: Math.round(box.x), y: Math.round(box.y), width: GAME_W, height: GAME_H };

    console.log('  ✓ menu rendered');

    // Three players makes the HUD panel worth looking at. Capture after the
    // selection so the shot shows the count highlight and the extra row.
    await clickGame(page, box, HOTSPOTS.playerCount3);
    await sleep(250);
    await shot(page, box, '1-menu');
    await clickGame(page, box, HOTSPOTS.startGame);

    if (!(await waitFor(page, forgeReady, { timeout: 12000 }))) {
      throw new Error('GameScene never exposed __forge — the game did not start');
    }
    await sleep(700);
    console.log('  ✓ board rendered, game started');
    await shot(page, box, '2-board');

    const start = await page.evaluate(() => window.__forge.state());
    if (start.players.length !== 3) {
      throw new Error(`expected 3 players, got ${start.players.length}`);
    }

    // ── Play ──────────────────────────────────────────────────────────────────
    let rolls = 0;
    let buys = 0;
    let cards = 0;
    let capturedBuy = false;
    let capturedCard = false;
    let capturedJail = false;

    for (let turn = 0; turn < TURNS; turn++) {
      await waitFor(page, idle, { timeout: 10000 });
      await clickGame(page, box, HOTSPOTS.roll);
      rolls++;

      // Let the dice settle and the token walk its tiles.
      await sleep(500);
      await waitFor(page, idle, { timeout: 12000 });
      await sleep(350);

      const view = await page.evaluate(() => ({
        buy: window.__forge.buyPromptOpen(),
        card: window.__forge.cardOpen(),
        state: window.__forge.state(),
      }));

      if (view.card) {
        cards++;
        if (!capturedCard) {
          await shot(page, box, '4-card');
          capturedCard = true;
        }
        await clickGame(page, box, HOTSPOTS.cardOk);
        await sleep(500);
      } else if (view.buy) {
        if (!capturedBuy) {
          await shot(page, box, '3-buy-prompt');
          capturedBuy = true;
        }
        // Buy roughly two thirds of what we land on, so the HUD shows spending
        // and later turns start charging rent.
        if (buys % 3 !== 2) {
          await clickGame(page, box, HOTSPOTS.buy);
          buys++;
        } else {
          await clickGame(page, box, HOTSPOTS.pass);
          buys++;
        }
        await sleep(450);
      }

      if (!capturedJail && view.state.players.some((p) => p.inJail)) {
        await shot(page, box, '5-jail');
        capturedJail = true;
      }

      await sleep(150);
    }

    await waitFor(page, idle, { timeout: 10000 });
    await sleep(400);

    // ── Assertions ────────────────────────────────────────────────────────────
    const end = await page.evaluate(() => window.__forge.state());
    const positions = end.players.map((p) => p.position);
    const cash = end.players.map((p) => p.cash);
    const owned = end.players.reduce((n, p) => n + p.ownedTileIds.length, 0);

    const problems = [];
    for (const p of end.players) {
      if (!Number.isInteger(p.position) || p.position < 0 || p.position > 39) {
        problems.push(`${p.name} has an invalid position: ${p.position}`);
      }
      if (!Number.isFinite(p.cash) || p.cash < 0) {
        problems.push(`${p.name} has invalid cash: ${p.cash}`);
      }
    }
    if (positions.every((p) => p === 0)) problems.push('no token ever left GO');
    if (owned === 0) problems.push('no property was bought in the whole run');
    if (!['WAITING_FOR_ROLL', 'END_TURN', 'LANDING', 'AWAITING_BUY_DECISION', 'MOVING', 'ROLLING']
      .includes(end.turn.phase)) {
      problems.push(`turn manager left in an unknown phase: ${end.turn.phase}`);
    }

    await shot(page, box, '6-late-game');

    console.log('');
    console.log(`  rolls attempted   ${rolls}`);
    console.log(`  buy prompts       ${buys}`);
    console.log(`  cards drawn       ${cards}`);
    console.log(`  positions         ${positions.join(', ')}`);
    console.log(`  cash              ${cash.map((c) => `$${c}`).join(', ')}`);
    console.log(`  tiles owned       ${owned}`);
    console.log(`  final phase       ${end.turn.phase}`);
    console.log(`  bank houses/hotels ${end.bank.houses}/${end.bank.hotels}`);
    console.log('');

    if (problems.length) failure = problems.join('\n  ');
  } catch (err) {
    failure = err.message;
  } finally {
    await browser.close();
    if (server) server.close();
  }

  if (errors.length) {
    console.error(`✗ ${errors.length} console error(s) / failed request(s):`);
    for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
    process.exit(1);
  }
  if (failure) {
    console.error(`✗ playtest failed:\n  ${failure}`);
    process.exit(1);
  }

  console.log('✓ playtest passed — no console errors, game state consistent');
}

main().catch((err) => {
  console.error('✗ harness crashed:', err);
  process.exit(1);
});
