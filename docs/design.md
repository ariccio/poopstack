# p(oop)stack design

The living design document. The dated plan it started from is `docs/planning/2026-10-19-plan.md`; when the two disagree, this file is current.

## What it is

A Claude Code mod that replaces the whimsical spinner words and the turn-closing line with bathroom puns that double as programming jokes, chosen from what Claude is actually doing: tests running, git commits, installs, compaction, long waits, interrupted turns.

## The contract: goofy but correct

1. **Jokes decorate; they never hide real information.** The status `message`, desktop step text, waiting-for-agents line, clock, errors and refusals stay visible and true. The mod must not lie to the user.
2. **Never break Claude Code.** No hook gates a tool call or a prompt. Every `ui.render` hook passes through on anything unexpected and has a `.catch` that passes through. The `tool.call` observer writes its state before `await next(e)`, returns the result unchanged, and its `.catch` uses `next.called`. Never touched: tool rows, message rows, AskUserQuestion, permission dialogs, PromptHint's `hint`.
3. **The model never sees a joke** in the core mod: no `prompt.compose`, no prompt context, no `attribution.text`. `/poopstack` returns neutral, true `text` and draws the joke as a `CommandOutput` tree. Only an explicitly installed persona pack may change this, and it says so.
4. **Off, at once.** `enabled` is declared in `userConfig`, and `/poopstack` is registered `immediate: true`. `off` writes the config through `$.config.set`, checks the result, and stops timers and sound. The README also gives the plugin-disable route.
5. **No flicker.** One base phrase per turn. A tool-context overlay applies only while that tool runs and clears on completion. Long waits grow a suffix; the word never changes mid-turn. The footer pairs with what was shown.
6. **Pairing honesty.** `TurnDuration` carries no turn id, but its `requestId` is the uuid of the turn's `turn_duration` row, which `session.append` hands over during that turn (a join probed on every closing line seen). So the footer is the past form of the phrase its own turn showed, written once both the row and the turn's end are known. A line the mod could not pair (a plain turn, a line drawn before it loaded, a turn cut by a reload) keeps Claude Code's own word; no footer is ever an unpaired joke. A joked line keeps Claude Code's own duration and time, and the preset's label is drawn after them ("Took a bio break for 42s · done 3:40 PM · 🚽 p(oop)stack"), so a reader can tell the word came from the mod; a "Refused" line carries nothing after it, and the label is left off where it would wrap the line.
7. **Counter honesty.** "Movements" counts main-agent turns. Session counts are exact; lifetime totals are labelled approximate. Only ids and aggregates are stored, never prompts, paths, commands or output. The report card is copied only through a button.

## Presets and engagement

| Preset | Who it is for | Jokes on | Footer on a joked turn |
|---|---|---|---|
| `discreet` | work-safe: no emoji, no body jokes | about 1 turn in 10 | the plain text `p(oop)stack` |
| `regular` | the default | about 1 turn in 5 | "🚽 p(oop)stack" |
| `maximum` | opt-in, the silliest | about 1 turn in 3 | "🚽 p(oop)stack" |

- The rates are guesses until measured. An `engagement` setting (`by-preset`, `rare`, `sometimes`, `often`, `always`) overrides them.
- Plain turns are left exactly as Claude Code draws them. Whether the mod is on always shows in `/poopstack` status.
- Matched lines (git, tests, subagents) roll their own dice, at about double the turn rate.
- Presets set the defaults; one `overrides` setting and the `/poopstack switches` panel turn single components on or off.

## Vocabulary rules

- **Outcome lines start with the real verb:** "Aborted mid-movement: you didn't lock the door, they didn't knock!" as a toast (an interrupted turn draws no closing line; regular and maximum only); "Failed: oopsie doopsie, had a lil poopsie" (discreet keeps Claude Code's own line); "Refused" with nothing after it.
- **Grammar:** every closing line is a durative past form that reads right before "for 42s".
- **Meaning:** a real event makes both readings true, and no line can be mistaken for a real failure.
- **Never:** a line shaped like a shell command; a line naming a real destructive operation; a copy of a real Claude Code status string (Retrying, Overloaded, Compacting, "blocked by hook"); the words "sphincter", "excretion", "core dump", "backup", "force"; "brown" in discreet.
- **One meaning per word:** "ply" is the rate-limit paper meter; "pressure" is effort; "stalls" are subagents; "floor" is sessions; "days running" is the streak.
- **Characters:** ASCII plus the ellipsis "…" and the middle dot "·", each with an ASCII fallback; the 🚽 only in the footer label outside discreet; a column cap per surface.
- **Repetition:** a per-session shuffle bag, a short recently-shown list across sessions, lines grouped by event, rare legendary lines.

## Surfaces

| Surface | What the mod changes |
|---|---|
| Terminal | Spinner, closing line, status, panes |
| Desktop | Spinner (only "Working"), status, panes |
| VS Code | Spinner (only "Working") |
| Mobile | Nothing |

Raster and image drawing is terminal-only, with a text fallback elsewhere.
