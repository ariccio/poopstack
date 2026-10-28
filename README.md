# p(oop)stack

**Early, and not announced yet.** This is the first phase of a joke mod for Claude Code; expect it to change.

A Claude Code mod that swaps the whimsical spinner words for bathroom puns, without hiding any real information. On a joked turn the spinner gets a pun ("Consulting the porcelain") and the closing line its past form ("Consulted the porcelain for 42s · done 3:40 PM · 🚽 p(oop)stack"). Most turns are left exactly as Claude Code draws them: it jokes on about 1 turn in 5. Claude Code's own status messages, errors, refusals, durations and times always show as they are.

## Install

```
/plugin install poopstack --marketplace ariccio/poopstack
```

Built and tested on Claude Code 2.1.311.

## Turn it down or off

- `/poopstack discreet`: work-safe words, no emoji, about 1 turn in 10.
- `/poopstack regular` (the default) or `/poopstack maximum` (the silliest, about 1 turn in 3).
- `/poopstack off` (or `/poop off`): stops every joke at once and saves the setting. `/poopstack on` brings them back; `/poopstack status` says where it stands.
- To disable it, run this in a terminal:

  ```
  claude plugin disable poopstack@poopstack
  ```

- To remove it, run this in a terminal:

  ```
  claude plugin uninstall poopstack@poopstack
  ```

## What it stores

- **On this machine, across sessions:** whether its one-time first-run note has been shown; and, for each session in which it showed a commit joke, that session's id, how many commit jokes it showed, and the time of the last one. A count left untouched for 30 days is removed at the next session start.
- **For the current session only:** its on or off state, its random-number state, the phrase in use, and which word each closing line was given (keyed by the line's own id).
- **Never:** your prompts, file paths, commands, or any tool output. It reads Claude Code's own report that a `git commit` succeeded, and keeps only the count.
- It makes no network requests, and the model never sees a joke: nothing the mod draws is sent to Claude.

## Credits

An affectionate parody of poteto's [pstack](https://github.com/cursor/plugins/tree/main/pstack); not affiliated. Written with Claude Code.

MIT licensed.
