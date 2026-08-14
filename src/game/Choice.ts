import { bus } from '@/utils/EventBus';
import { dwarn } from '@/utils/log';

// ─── Choice ───────────────────────────────────────────────────────────────────
// "Which one?", asked so that a person and a bot can both answer.
//
// The engine has been able to ask exactly two questions — buy this deed, and bid
// how much — and both are hardcoded, one panel each, one bot function each. That
// closed set is why three printed rules ship reduced: the speed die's triples
// ("move anywhere on the board"), Ultimate Monopoly's Subway ("travel to any
// space") and its Auction square ("pick an unowned property"). A fourth, the
// contested-house winner choosing which lot to build on, was never a rule at all
// — it just picks for you.
//
// So a choice is data. Somebody asks, a driver answers, and a callback carries
// the answer back:
//
//   * `GameScene` shows it — as a list when the options are few, or as the board
//     itself when they are tiles and there are many. Clicking 120 rows is not a
//     prompt.
//   * `sim/Runner` hands it to `Bot`, immediately and synchronously.
//
// **A prompt with no bot path waits for ever on a bot's turn**, which is the
// rule in CLAUDE.md every modal has had to pay since M7. `answer` is called
// exactly once; asking twice for the same thing is a bug in the asker, not
// something this defends against.
//
// Not in the snapshot, deliberately: a choice is a question in flight, and a
// restore resumes at the start of a turn where no question is outstanding. The
// pause menu refuses to save while one is open, the same way it does mid-auction.

export interface ChoiceOption {
  id: string;
  label: string;
  /** The tile this option means, when it means one. Board-style choices need it. */
  tileId?: number;
  /**
   * What a bot thinks it is worth. The default policy takes the largest, so an
   * asker that offers no weights gets the first option — deterministic, and the
   * same answer the deterministic code it replaced would have given.
   */
  weight?: number;
}

export interface ChoiceRequest {
  /** What is being asked — `'triples'`, `'houseLot'`. For logs and the harness. */
  id: string;
  playerId: string;
  prompt: string;
  options: ChoiceOption[];
  /**
   * `board` highlights the option tiles and waits for one to be clicked; `list`
   * draws the options as rows. A hundred and twenty rows is not a prompt, and
   * three tiles scattered round a board are hard to compare — so the asker says
   * which it is rather than a threshold guessing.
   */
  style: 'list' | 'board';
  /** Called once, with the chosen option's id. */
  answer(optionId: string): void;
}

/**
 * Ask, and let a driver answer. Returns false when nothing is listening — which
 * is a real case in a unit test, and one the asker has to be able to survive.
 */
export function askChoice(request: ChoiceRequest): boolean {
  if (!request.options.length) {
    dwarn(`[Choice] "${request.id}" asked with no options — nobody can answer that`);
    return false;
  }
  let answered = false;
  const once: ChoiceRequest = {
    ...request,
    answer: (optionId: string) => {
      if (answered) {
        dwarn(`[Choice] "${request.id}" answered twice; the second is ignored`);
        return;
      }
      answered = true;
      request.answer(optionId);
    },
  };
  bus.emit('choice:ask', once);
  return true;
}

/**
 * What a bot picks: the heaviest option, first on a tie. Deliberately a plain
 * function rather than a registry — a *policy* worth registering would need to
 * know what the choice means, and every asker already expresses that by what it
 * puts in `weight`.
 */
export function preferredOption(request: ChoiceRequest): ChoiceOption {
  return request.options.reduce(
    (best, option) => ((option.weight ?? 0) > (best.weight ?? 0) ? option : best),
  );
}
