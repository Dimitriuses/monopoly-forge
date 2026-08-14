import { simulate, type SimResult } from '@/sim/Runner';
import { summarise, formatSummary, type Summary } from '@/sim/Report';
import { GAMES } from '@/games';
import { PROFILES } from '@/game/Bot';

// ─── The batch CLI ────────────────────────────────────────────────────────────
// `npm run simulate -- --game classic --games 1000 --seed 1`
//
// Plays a game a thousand times and reports what a balance pass needs: how often
// somebody goes bankrupt, how long a game runs, how often the bank runs out of
// houses, and how often a game fails to end at all.
//
// It names a *game* rather than taking a pile of switches, which is the whole
// reason M9a came first: "a thousand games" over which map, economy and variants
// is a question the old shape could not answer, and a report that cannot say
// what it ran is not evidence.

interface Options {
  games: string[];
  runs: number;
  seed: number;
  players: number;
  profiles: string[];
  maxTurns: number;
  /** Play under a round limit, so every game is guaranteed to end. */
  roundLimit: number;
  checkInvariants: boolean;
  json: boolean;
}

function parse(argv: string[]): Options {
  const flag  = (name: string) => argv.includes(`--${name}`);
  const value = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
  };

  const named = value('game', 'all');
  return {
    games: named === 'all' ? Object.keys(GAMES) : named.split(','),
    runs:     Number(value('games', '200')),
    seed:     Number(value('seed', '1')),
    players:  Number(value('players', '4')),
    profiles: value('policies', '').split(',').filter(Boolean),
    maxTurns:   Number(value('max-turns', '6000')),
    roundLimit: Number(value('round-limit', '0')),
    checkInvariants: !flag('no-invariants'),
    json: flag('json'),
    mirror: flag('mirror'),
  };
}

function seats(options: Options): number | Array<{ profile?: typeof PROFILES[string] }> {
  if (!options.profiles.length) return options.players;
  // One seat per named policy, so `--policies baseline,aggressive` is a match
  // between them rather than a table of clones.
  return options.profiles.map((name) => {
    const profile = PROFILES[name];
    if (!profile) throw new Error(`no policy called "${name}" — known: ${Object.keys(PROFILES).join(', ')}`);
    return { profile };
  });
}

/**
 * Play the same batch once per seating order and tally wins by *policy*.
 *
 * Without this a policy match says almost nothing: 8d measured seat order at
 * roughly 60/40 to the first two seats of four, and worse than that heads-up —
 * so a policy in seat 1 wins whether or not it is any good. Rotating cancels it,
 * because every policy sits in every seat exactly once.
 */
function mirrored(options: Options): void {
  const names = options.profiles;
  const wins: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  let finished = 0;
  let games = 0;

  for (let rotation = 0; rotation < names.length; rotation++) {
    const order = names.map((_, i) => names[(i + rotation) % names.length]);
    for (const id of options.games) {
      for (let i = 0; i < options.runs; i++) {
        const result = simulate({
          game: id,
          // The same seeds in every rotation, so the two orderings play the same
          // dice and the only difference is who sat where.
          seed: options.seed + i,
          players: order.map((name) => ({ profile: PROFILES[name] })),
          maxTurns: options.maxTurns,
          checkInvariants: false,
          rules: options.roundLimit
            ? { winCondition: 'roundLimit', roundLimit: options.roundLimit }
            : undefined,
        });
        games++;
        if (result.winnerId === null) continue;
        finished++;
        const seat = Number(result.winnerId.replace(/[^0-9]/g, '')) - 1;
        if (order[seat]) wins[order[seat]]++;
      }
    }
  }

  const width = Math.max(...names.map((n) => n.length));
  console.log(`\n▶ mirrored: ${names.length} seating order(s) × ${options.runs} games ` +
              `× ${options.games.length} game(s) = ${games} played, ${finished} finished\n`);
  for (const name of names) {
    const share = finished ? Math.round((wins[name] / finished) * 100) : 0;
    console.log(`  ${name.padEnd(width)}  ${String(wins[name]).padStart(5)}  ${share}%`);
  }
  const spread = Math.max(...names.map((n) => wins[n])) - Math.min(...names.map((n) => wins[n]));
  console.log(
    `\n  spread ${spread} of ${finished} — ` +
    (spread / Math.max(1, finished) < 0.05
      ? 'inside the noise. No policy here is better than another.'
      : 'outside the noise.'),
  );
}

function main(): void {
  const options = parse(process.argv.slice(2));
  const unknown = options.games.filter((id) => !GAMES[id]);
  if (unknown.length) {
    console.error(`✗ no game called ${unknown.join(', ')} — this build ships ${Object.keys(GAMES).join(', ')}`);
    process.exit(1);
  }

  if (options.mirror) {
    if (options.profiles.length < 2) {
      console.error('✗ --mirror needs at least two policies: --policies a,b --mirror');
      process.exit(1);
    }
    mirrored(options);
    return;
  }

  const table = seats(options);
  const summaries: Summary[] = [];
  let broken: SimResult | null = null;

  for (const id of options.games) {
    const results: SimResult[] = [];
    const started = Date.now();

    for (let i = 0; i < options.runs; i++) {
      const result = simulate({
        game: id,
        seed: options.seed + i,
        players: table,
        maxTurns: options.maxTurns,
        checkInvariants: options.checkInvariants,
        rules: options.roundLimit
          ? { winCondition: 'roundLimit', roundLimit: options.roundLimit }
          : undefined,
      });
      results.push(result);
      if (result.violations.length && !broken) broken = result;
    }

    summaries.push(summarise(id, results, Date.now() - started));
  }

  if (options.json) {
    console.log(JSON.stringify(summaries, null, 2));
  } else {
    console.log(formatSummary(summaries, {
      runs: options.runs, seed: options.seed,
      seats: options.profiles.length ? options.profiles.join(' vs ') : `${options.players} bots`,
    }));
  }

  if (broken) {
    console.error(`\n✗ invariants broken in ${broken.gameId} seed ${broken.seed}:`);
    for (const v of broken.violations) console.error(`  ${v.what}: ${v.detail}`);
    process.exit(1);
  }

  // A game that runs past the cap is *reported*, not failed. Monopoly genuinely
  // does not always terminate: four players who never complete a colour group
  // build nothing, so rent stays below the salary and nobody can ever go under.
  // One of these ran 60,000 turns with £1.4M on the table and no houses at all.
  // That is a property of the game, not a bug in it — `--round-limit` is how a
  // batch asks for one that always ends.
  const stuck = summaries.filter((s) => s.unfinished > 0);
  if (stuck.length) {
    console.log(
      `  ⚠ ${stuck.map((s) => `${s.gameId} ${s.unfinished}/${s.runs}`).join(', ')} ` +
      `ran past ${options.maxTurns} turns — no monopoly formed.\n` +
      '    Not a failure: pass --round-limit N for a batch that is bounded by a rule.',
    );
  }
  console.log('✓ no invariant broke');
}

main();
