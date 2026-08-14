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
/** Leave the menu's default seats alone and watch the bots play instead. */
const BOTS = flag('bots');
const TURNS = Number(value('turns', TAKE_SHOTS ? 26 : 30));
const SEED = Number(value('seed', 20260512));
const EXTERNAL_URL = value('url', null);
/**
 * Which game to play. A game is a board, an economy, a deck and a palette in one
 * folder (M9a) — `--game roundabout` is the whole choice, where `--map round`
 * used to be the board with its economy hidden inside the map file.
 */
const GAME = value('game', null);
/** Comma-separated variants to switch on, e.g. `--variants speedDie`. */
const VARIANTS = value('variants', null);
/**
 * Play with the house rules on. The two that can be *observed* from outside —
 * the Free Parking jackpot pools fines and taxes, and GO pays twice for landing
 * on it. `noAuction` is left out on purpose: it would turn off the auction step
 * this run depends on.
 */
const HOUSE_RULES = flag('house-rules') ? 'freeParkingJackpot,doubleGoSalary' : null;
/** Which palette to draw in — `--theme parchment` is the one that is not default. */
const THEME = value('theme', null);

// The Phaser canvas is a fixed 1280×800 with no scale manager, so game
// coordinates map 1:1 onto canvas pixels.
const GAME_W = 1280;
const GAME_H = 800;

const HOTSPOTS = {
  // The menu is not in this table any more. It is a tree of screens whose rows
  // move as games, variants and save slots are added, so it reports its own
  // positions through `__menu.spots()` and the harness clicks rows *by name* —
  // the same answer `tileCentre()` and `tradeSpots()` already gave.
  roll:         [512, 738],  // GameScene.buildButtons
  jail:         [710, 738],  // GameScene.buildButtons (hidden unless offered)
  buy:          [424, 458],  // GameScene.showBuyPrompt, container at (512,400)
  pass:         [600, 458],
  cardOk:       [640, 490],  // CardScene: (width/2, height/2 + 90)
  auctionBid:   [382, 426],  // AuctionPanel, container at (512,400): first bid button
  auctionPass:  [512, 484],  // AuctionPanel pass button
  trade:        [180, 738],  // GameScene.buildButtons
  pause:        [300, 738],  // GameScene.buildButtons — was SAVE before M10
  // The trade panel is not in this table any more. Its deed list is measured
  // rather than reserved, so its buttons sit wherever the players' holdings put
  // them — it reports its own positions through `__forge.tradeSpots()`.
};

// ─── Driving the menu ─────────────────────────────────────────────────────────
// Rows by name, never by coordinate. `__menu` is published by whichever menu is
// on screen (the title screen or the pause screen), so the same three helpers
// drive both.

async function menuSpots(page) {
  return page.evaluate(() => (window.__menu ? window.__menu.spots() : []));
}

/** Click a menu row by id. Fails loudly — a silent miss is the old bug. */
async function menuPress(page, box, id, { adjust = 0 } = {}) {
  const spots = await menuSpots(page);
  const row = spots.find((s) => s.id === id);
  if (!row) {
    throw new Error(
      `menu row "${id}" is not on screen; rows are: ${spots.map((s) => s.id).join(', ') || 'none'}`,
    );
  }
  if (!row.enabled) throw new Error(`menu row "${id}" is disabled`);
  // A value row nudges from its ‹ › buttons, and the menu reports where those
  // are — nothing here works out an offset from the row's centre.
  const x = adjust === 0 ? row.x : (adjust < 0 ? row.decX : row.incX);
  if (x === null || x === undefined) {
    throw new Error(`menu row "${id}" has no ‹ › to nudge`);
  }
  await clickGame(page, box, [x, row.y]);
  await sleep(140);
}

/** Nudge a value row until it reads what we want, or give up loudly. */
async function menuSet(page, box, id, wanted, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const row = (await menuSpots(page)).find((s) => s.id === id);
    if (!row) throw new Error(`menu row "${id}" is not on screen`);
    if (String(row.value ?? '') === String(wanted)) return;
    await menuPress(page, box, id, { adjust: 1 });
  }
  const row = (await menuSpots(page)).find((s) => s.id === id);
  throw new Error(`could not set "${id}" to ${wanted}; it reads ${row && row.value}`);
}

/** Where a trade-panel control is right now, asked of the panel itself. */
async function tradeSpot(page, name) {
  const spots = await page.evaluate(() => window.__forge.tradeSpots());
  const spot = spots[name];
  if (!spot) {
    throw new Error(`the trade panel has no "${name}" — it has ${Object.keys(spots).join(', ')}`);
  }
  return [spot.x, spot.y];
}

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

/**
 * Tokens sharing a square must be clustered, not stacked. Returns a complaint
 * string, or null when every piece on a shared tile has its own spot.
 */
async function checkTokenSpacing(page, where) {
  const tokens = await page.evaluate(() => window.__forge.tokens());
  const entries = Object.entries(tokens);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, a] = entries[i];
      const [idB, b] = entries[j];
      if (a.tile !== b.tile) continue;
      const apart = Math.hypot(a.x - b.x, a.y - b.y);
      if (apart < 8) {
        return `${where}: ${idA} and ${idB} share tile ${a.tile} but sit ${apart.toFixed(1)}px apart`;
      }
    }
  }
  return null;
}

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

  const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}debug=1&seed=${SEED}`
            + (GAME ? `&game=${GAME}` : '')
            + (VARIANTS ? `&variants=${VARIANTS}` : '')
            + (HOUSE_RULES ? `&houseRules=${HOUSE_RULES}` : '')
            + (THEME ? `&theme=${THEME}` : '');
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

    await shot(page, box, '1-menu');

    // Walk the settings tree before starting, so the generated rule screens are
    // exercised rather than skipped past. Changing a rule here also proves the
    // override actually reaches the game: it is asserted against `__forge.rules()`
    // once the board is up.
    await menuPress(page, box, 'settings');
    await menuPress(page, box, 'sound', { adjust: -1 });
    await menuPress(page, box, 'back');

    await menuPress(page, box, 'play');
    await menuPress(page, box, 'rules');
    await menuPress(page, box, 'group.jail');
    await menuPress(page, box, 'rule.jailFine', { adjust: 1 });
    const jailFine = (await menuSpots(page)).find((r) => r.id === 'rule.jailFine');
    await shot(page, box, '1c-settings');
    await menuPress(page, box, 'back');
    await menuPress(page, box, 'back');

    // Three players makes the HUD panel worth looking at.
    await menuSet(page, box, 'count', '3');
    if (BOTS) {
      // Seat 1 is yours by default; hand it over too, so nobody has to click.
      await menuPress(page, box, 'seat1', { adjust: 1 });
    } else {
      // All-human keeps the buy prompt, auction and trade steps below on rails.
      await menuPress(page, box, 'seat2', { adjust: 1 });
      await menuPress(page, box, 'seat3', { adjust: 1 });
    }
    await sleep(200);
    await shot(page, box, '1b-play');
    await menuPress(page, box, 'start');
    const wantedJailFine = Number(String(jailFine.value).replace(/[^0-9]/g, ''));

    if (!(await waitFor(page, forgeReady, { timeout: 12000 }))) {
      throw new Error('GameScene never exposed __forge — the game did not start');
    }
    await sleep(700);
    console.log('  ✓ board rendered, game started');

    // The menu edited a rule; the game had better be playing by it. This is the
    // check that would have caught M9b's silently-ignored house rule.
    const liveRules = await page.evaluate(() => window.__forge.rules());
    if (liveRules.jailFine !== wantedJailFine) {
      throw new Error(
        `the menu set the jail fine to ${wantedJailFine} and the game is playing ${liveRules.jailFine}`,
      );
    }
    console.log(`  ✓ a rule changed on the menu reached the game (jail fine $${wantedJailFine})`);
    await shot(page, box, '2-board');

    // Everyone starts on GO — the busiest square a game ever has.
    const stacked = await checkTokenSpacing(page, 'at the start');
    if (stacked) throw new Error(stacked);
    console.log('  ✓ tokens on GO are clustered, not stacked');

    const start = await page.evaluate(() => window.__forge.state());
    if (start.players.length !== 3) {
      throw new Error(`expected 3 players, got ${start.players.length}`);
    }

    // A variant that reshapes the turn has to be *in* the turn — and if the
    // extra step ever held the turn without giving it back, the stall detector
    // below is what would catch it.
    //
    // Asked of the *rules in force* rather than of the flag: a variant can come
    // from `--variants`, or from the game itself (`--game speed` does), and this
    // has to hold either way.
    const inPlay = await page.evaluate(() => window.__forge.rules().variants ?? []);
    if (inPlay.includes('speedDie')) {
      const turn = await page.evaluate(() => window.__forge.phases());
      if (!turn.includes('SPEED_BONUS')) {
        throw new Error(`the speed die is in play but the turn is ${turn.join(' → ')}`);
      }
      console.log(`  ✓ speed die in play — the turn is ${turn.length} phases`);
    } else if (VARIANTS?.includes('speedDie')) {
      throw new Error('--variants speedDie was passed but the game is not playing it');
    }

    // Read from the rules in force, not from the flag: a *game* can ask for a
    // house rule too (Pocket wants the Free Parking jackpot), and the assertions
    // below have to be about what is actually being played.
    const inForce = await page.evaluate(() => window.__forge.rules());
    const jackpot = inForce.freeParkingJackpot === true;

    // A game may bring its own artwork (`Game.assets`). A drawn texture is a
    // canvas; one the loader fetched is an image — which is how this tells the
    // two apart without comparing pixels, and how it would notice the loader
    // silently skipping a key the texture manager already held. It did once.
    const artwork = await page.evaluate(() => window.__forge.textures());
    const supplied = Object.entries(artwork).filter(([, kind]) => kind === 'HTMLImageElement');
    if (supplied.length) {
      console.log(`  ✓ ${supplied.length} texture(s) from the game: ${supplied.map(([k]) => k).join(', ')}`);
    }

    if (HOUSE_RULES) {
      const missing = HOUSE_RULES.split(',').filter((key) => inForce[key] !== true);
      if (missing.length) {
        throw new Error(`house rules were switched on but the game is not playing them: ${missing}`);
      }
      console.log(`  ✓ house rules in force: ${HOUSE_RULES.split(',').join(', ')}`);
    }

    // ── Bot mode: no clicking, just check they play a real game ───────────────
    if (BOTS) {
      const bots = start.players.filter((p) => p.isBot).length;
      if (bots !== 3) throw new Error(`expected every seat to be a bot, got ${bots}`);
      console.log(`  ✓ ${bots} bot seats; watching them play`);

      let stalls = 0;
      let finished = false;
      let previous = '';
      // The last houses go under the hammer, and a played game only reaches that
      // board at the very end. Arrange it a third of the way in and watch what
      // the bots do — bidding for a house is a prompt they owe an answer to.
      const shortageAt = Math.max(3, Math.floor(TURNS / 3));
      // And a bankruptcy owing the bank, which puts a whole estate under the
      // hammer, deed by deed. Nobody is clicking here, so it can play out.
      const bankruptcyAt = Math.max(5, Math.floor(TURNS / 5));
      let houseAuction = null;
      let estateAuctions = 0;
      let bankrupted = null;

      for (let tick = 0; tick < TURNS; tick++) {
        await sleep(1200);

        if (tick === shortageAt) {
          const lot = await page.evaluate(() => window.__forge.forceHouseShortage());
          if (lot === null) console.log('  · this board cannot make a house shortage — skipped');
          else console.log(`  · arranged a house shortage around tile ${lot}`);
        }
        if (tick === bankruptcyAt) {
          bankrupted = await page.evaluate(() => window.__forge.forceBankruptcy());
          console.log(bankrupted
            ? `  · bankrupted ${bankrupted} owing the bank — the estate goes to auction`
            : '  · nobody could be bankrupted yet — skipped');
        }
        const auction = await page.evaluate(() => window.__forge.auctionState());
        if (!houseAuction && auction?.subject?.kind === 'house') houseAuction = auction;
        if (bankrupted && auction?.subject?.kind === 'tile') estateAuctions++;
        if (await page.evaluate(() => window.__forge.gameOver())) {
          console.log(`  ✓ a bot won the game outright after ${tick} ticks`);
          finished = true;
          break;
        }
        // The whole state, not just the players: bidding moves the auction for
        // several seconds without touching anybody's cash, and comparing players
        // alone reported a busy auction as a frozen game.
        const serialised = await page.evaluate(() => JSON.stringify([
          window.__forge.state(), window.__forge.auctionState(),
        ]));
        stalls = serialised === previous ? stalls + 1 : 0;
        previous = serialised;
        if (stalls >= 6) {
          // Say what it is stuck *on* — an open modal nobody will close is the
          // usual answer, and "the bots stopped" alone sends you hunting.
          const stuck = await page.evaluate(() => ({
            phase:     window.__forge.phase(),
            active:    window.__forge.activeId(),
            animating: window.__forge.isAnimating(),
            buyPrompt: window.__forge.buyPromptOpen(),
            card:      window.__forge.cardOpen(),
            auction:   window.__forge.auctionOpen(),
            auctionState: window.__forge.auctionState(),
            trade:     window.__forge.tradeOpen(),
            players:   window.__forge.state().players.map(
              (p) => `${p.id}${p.isBot ? '(bot)' : ''} pos=${p.position} $${p.cash}` +
                     `${p.inJail ? ' jailed' : ''}${p.isBankrupt ? ' bankrupt' : ''}`),
          }));
          throw new Error(
            `the bots stopped playing after ${tick} ticks\n  ${JSON.stringify(stuck, null, 2)}`,
          );
        }
      }
      void finished;

      const end = await page.evaluate(() => window.__forge.state());
      const owned = end.players.reduce((n, p) => n + p.ownedTileIds.length, 0);
      const moved = end.players.some((p) => p.position !== 0);
      await shot(page, box, '12-bots');

      console.log('');
      console.log(`  positions      ${end.players.map((p) => p.position).join(', ')}`);
      console.log(`  cash           ${end.players.map((p) => `$${p.cash}`).join(', ')}`);
      console.log(`  tiles owned    ${owned}`);
      console.log(`  bank h/h       ${end.bank.houses}/${end.bank.hotels}`);
      const built = end.board.tiles.reduce((n, t) => n + (t.houses ?? 0), 0);
      // Straight from the turn log, which now keeps everything rather than the
      // dozen lines that happened to fit on screen.
      const log = await page.evaluate(() => window.__forge.log());
      const trades = log.filter((line) => line.includes('🤝')).length;
      console.log(`  houses built   ${built}`);
      console.log(`  log lines      ${log.length}`);
      console.log(`  bot trades     ${trades}`);
      console.log(`  estate deeds   ${bankrupted
        ? `${estateAuctions} tick(s) with a returned deed under the hammer`
        : 'nobody went bankrupt'}`);
      console.log(`  house auction  ${houseAuction
        ? `held, ${houseAuction.bidders.length} bidders, opened at $${houseAuction.minimumBid}`
        : 'never happened'}`);
      console.log('');

      if (!moved) throw new Error('no bot token ever left GO');
      if (owned === 0) throw new Error('the bots never bought anything');
      if (!houseAuction) {
        throw new Error('the bank ran short of houses and nothing went under the hammer');
      }
      if (houseAuction.bidders.length < 2) {
        throw new Error(`a contested house drew ${houseAuction.bidders.length} bidder(s)`);
      }
      if (bankrupted && estateAuctions === 0) {
        throw new Error('an estate went back to the bank and none of it was auctioned');
      }
      // The log used to keep only what fitted on screen. A run this long says
      // more than a dozen things.
      if (TURNS >= 40 && log.length <= 12) {
        throw new Error(`the turn log kept only ${log.length} entries — no scrollback`);
      }

      if (errors.length) {
        console.error(`✗ ${errors.length} console error(s):`);
        for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
        process.exit(1);
      }
      console.log('✓ bot playtest passed — the bots played a clean game on their own');
      await browser.close();
      if (server) server.close();
      return;
    }

    // ── Play ──────────────────────────────────────────────────────────────────
    let rolls = 0;
    let buys = 0;
    let cards = 0;
    let auctions = 0;
    let deadRolls = 0;
    let capturedBuy = false;
    let capturedCard = false;
    let capturedJail = false;
    let capturedAuction = false;
    /** The most the Free Parking pot ever held — 0 means the rule did nothing. */
    let biggestPot = 0;
    let taxLandings = 0;
    // Asked of the board, not listed here — see the position check below.
    const TAX_TILES = (await page.evaluate(() => window.__forge.board())).taxTiles;

    for (let turn = 0; turn < TURNS; turn++) {
      await waitFor(page, idle, { timeout: 10000 });
      // A dead ROLL button is silent: the run would finish, and the assertions
      // below would still pass on what the earlier turns did. Watch for a roll
      // that changes nothing at all instead.
      const beforeRoll = await page.evaluate(() => {
        const s = window.__forge.state();
        return JSON.stringify([s.dice, s.players]);
      });
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
      biggestPot = Math.max(biggestPot, view.state.bank.pot ?? 0);
      // Whether anything *should* have pooled. The pot assertion below is only
      // meaningful once a tax has actually been charged, and on a 120-tile board
      // eleven rounds can pass without anybody meeting one of the two tax
      // squares — which failed a perfectly good Ultimate run.
      if (view.state.players.some((p) => TAX_TILES.includes(p.position))) taxLandings++;

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
        const declining = buys % 3 === 2;
        await clickGame(page, box, declining ? HOTSPOTS.pass : HOTSPOTS.buy);
        buys++;
        await sleep(450);

        // Declining opens an auction. Bid once the first time so a deed changes
        // hands under the hammer, then pass every bidder out.
        if (await page.evaluate(() => window.__forge.auctionOpen())) {
          auctions++;
          if (!capturedAuction) {
            await shot(page, box, '8-auction');
            capturedAuction = true;
            await clickGame(page, box, HOTSPOTS.auctionBid);
            await sleep(300);
          }
          for (let guard = 0; guard < 8; guard++) {
            if (!(await page.evaluate(() => window.__forge.auctionOpen()))) break;
            await clickGame(page, box, HOTSPOTS.auctionPass);
            await sleep(250);
          }
          if (await page.evaluate(() => window.__forge.auctionOpen())) {
            throw new Error('the auction never closed — passing did not end it');
          }
          await sleep(300);
        }
      }

      if (!capturedJail && view.state.players.some((p) => p.inJail)) {
        await shot(page, box, '5-jail');
        capturedJail = true;
      }

      const overlap = await checkTokenSpacing(page, `turn ${turn}`);
      if (overlap) throw new Error(overlap);

      const afterRoll = JSON.stringify([view.state.dice, view.state.players]);
      if (afterRoll === beforeRoll && !view.card && !view.buy) {
        deadRolls++;
        if (deadRolls >= 3) {
          throw new Error(
            `three rolls in a row changed nothing (turn ${turn}) — ` +
            'the ROLL button has stopped responding',
          );
        }
      } else {
        deadRolls = 0;
      }

      await sleep(150);
    }

    await waitFor(page, idle, { timeout: 10000 });
    await sleep(400);

    // ── Property panel ────────────────────────────────────────────────────────
    // Click an owned tile on the board and check the inspector opens on it.
    // Tile centres come from __forge.tileCentre so the harness does not keep a
    // second copy of the board geometry.
    let panelTileId = null;
    const ownedByAnyone = await page.evaluate(() =>
      window.__forge.state().players.flatMap((p) => p.ownedTileIds));

    if (ownedByAnyone.length) {
      panelTileId = ownedByAnyone[0];
      const centre = await page.evaluate((id) => window.__forge.tileCentre(id), panelTileId);
      await clickGame(page, box, [centre.x, centre.y]);
      await sleep(300);

      const opened = await page.evaluate((id) =>
        window.__forge.panelOpen() && window.__forge.panelTile() === id, panelTileId);
      if (!opened) throw new Error(`clicking tile ${panelTileId} did not open the property panel`);
      await shot(page, box, '7-property-panel');

      // Clicking the same tile again closes it.
      await clickGame(page, box, [centre.x, centre.y]);
      await sleep(250);
      if (await page.evaluate(() => window.__forge.panelOpen())) {
        throw new Error('clicking the selected tile again did not close the property panel');
      }
    }

    // ── Trade ─────────────────────────────────────────────────────────────────
    // Give one of the active player's deeds away: a one-sided offer is a legal
    // trade, and it exercises build → propose → accept end to end.
    let tradedTile = null;
    const holder = await page.evaluate(() => {
      const state = window.__forge.state();
      const active = state.players.find((p) => p.id === window.__forge.activeId());
      return active && active.ownedTileIds.length ? active : null;
    });

    if (!holder) {
      console.log('  · active player owns nothing — trade step skipped');
    } else {
      await clickGame(page, box, HOTSPOTS.trade);
      await sleep(300);
      if (!(await page.evaluate(() => window.__forge.tradeOpen()))) {
        throw new Error('the TRADE button did not open the trade panel');
      }
      await shot(page, box, '9-trade');

      await clickGame(page, box, await tradeSpot(page, 'left:row1'));
      await sleep(200);
      const offer = await page.evaluate(() => window.__forge.tradeOffer());
      if (!offer || offer.fromTileIds.length !== 1) {
        throw new Error(`clicking a deed row did not add it to the offer (${JSON.stringify(offer)})`);
      }
      tradedTile = offer.fromTileIds[0];
      const recipient = offer.toId;

      await clickGame(page, box, await tradeSpot(page, 'propose'));
      await sleep(250);
      await shot(page, box, '10-trade-review');
      await clickGame(page, box, await tradeSpot(page, 'accept'));
      await sleep(400);

      if (await page.evaluate(() => window.__forge.tradeOpen())) {
        throw new Error('accepting the trade did not close the panel');
      }
      const afterTrade = await page.evaluate(() => window.__forge.state());
      const newOwner = afterTrade.board.tiles[tradedTile].ownerId;
      if (newOwner !== recipient) {
        throw new Error(`traded tile ${tradedTile} went to ${newOwner}, expected ${recipient}`);
      }
      console.log(`  ✓ traded tile ${tradedTile} to ${recipient}`);
    }

    // ── Save and restore ──────────────────────────────────────────────────────
    // Save, reload the page, resume from the menu, and check the game came back
    // exactly as it was. The turn phase is excluded on purpose: a restore always
    // resumes at the start of the saved player's turn.
    const beforeSave = await page.evaluate(() => window.__forge.state());
    await clickGame(page, box, HOTSPOTS.pause);
    await sleep(400);
    await menuPress(page, box, 'save');
    await menuPress(page, box, 'slot1');
    await sleep(400);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('canvas');
    await sleep(900);
    await menuPress(page, box, 'load');
    await menuPress(page, box, 'slot1');

    if (!(await waitFor(page, forgeReady, { timeout: 12000 }))) {
      throw new Error('CONTINUE did not start the saved game');
    }
    await sleep(600);

    const restored = await page.evaluate(() => window.__forge.state());
    const strip = (state) => JSON.stringify({
      players: state.players,
      board: state.board,
      bank: state.bank,
      currentPlayerIndex: state.turn.currentPlayerIndex,
      round: state.turn.round,
    });
    if (strip(restored) !== strip(beforeSave)) {
      throw new Error(
        'restored game does not match the save\n' +
        `  before: ${strip(beforeSave).slice(0, 300)}\n` +
        `  after : ${strip(restored).slice(0, 300)}`,
      );
    }
    console.log('  ✓ saved, reloaded and resumed with identical state');
    await shot(page, box, '11-restored');

    // ── Assertions ────────────────────────────────────────────────────────────
    const end = await page.evaluate(() => window.__forge.state());
    // Asked of the game rather than listed here: a rule set may add a phase, and
    // a hardcoded list would fail the run for using the feature.
    const phases = await page.evaluate(() => window.__forge.phases());
    const positions = end.players.map((p) => p.position);
    const cash = end.players.map((p) => p.cash);
    const owned = end.players.reduce((n, p) => n + p.ownedTileIds.length, 0);

    // Asked of the board rather than assumed: Ultimate Monopoly is 120 tiles,
    // and a hardcoded 39 here failed a perfectly good game for using the engine.
    const board = await page.evaluate(() => window.__forge.board());

    const problems = [];
    for (const p of end.players) {
      if (!Number.isInteger(p.position) || p.position < 0 || p.position >= board.size) {
        problems.push(`${p.name} has an invalid position: ${p.position}`);
      }
      if (!Number.isFinite(p.cash) || p.cash < 0) {
        problems.push(`${p.name} has invalid cash: ${p.cash}`);
      }
    }
    if (positions.every((p) => p === 0)) problems.push('no token ever left GO');
    if (owned === 0) problems.push('no property was bought in the whole run');
    if (panelTileId === null) problems.push('no owned tile to inspect — the panel was never exercised');
    if (auctions === 0) problems.push('no property was ever declined into an auction');
    if (!phases.includes(end.turn.phase)) {
      problems.push(
        `turn manager left in a phase this game's turn does not contain: ` +
        `${end.turn.phase} (turn is ${phases.join(' → ')})`,
      );
    }
    if (!Number.isInteger(end.turn.round) || end.turn.round < 1) {
      problems.push(`the round counter is not a round: ${end.turn.round}`);
    }
    // The switch being on is one thing; the rule doing something is another. A
    // fine or a tax on any turn pools on Free Parking, and this seed has both.
    // Pocket is the game that brings artwork; if it stops arriving, say so here
    // rather than leaving a silently-drawn house to be noticed by eye.
    if (GAME === 'pocket' && supplied.length !== 2) {
      problems.push(`pocket brings two textures and ${supplied.length} arrived`);
    }
    if (jackpot && taxLandings > 0 && biggestPot === 0) {
      problems.push('a tax was charged with the Free Parking jackpot on and the pot stayed empty');
    }
    if (!jackpot && biggestPot > 0) {
      problems.push(`the pot filled with the jackpot rule off: $${biggestPot}`);
    }

    await shot(page, box, '6-late-game');

    console.log('');
    console.log(`  rolls attempted   ${rolls}`);
    console.log(`  buy prompts       ${buys}`);
    console.log(`  auctions held     ${auctions}`);
    console.log(`  cards drawn       ${cards}`);
    console.log(`  positions         ${positions.join(', ')}`);
    console.log(`  cash              ${cash.map((c) => `$${c}`).join(', ')}`);
    console.log(`  tiles owned       ${owned}`);
    console.log(`  final phase       ${end.turn.phase} (of ${phases.length})`);
    console.log(`  rounds played     ${end.turn.round}`);
    console.log(`  biggest pot       $${biggestPot}${jackpot ? '' : ' (jackpot rule off)'}`);
    console.log(`  panel opened on   ${panelTileId === null ? 'nothing' : `tile ${panelTileId}`}`);
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
