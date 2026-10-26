# Error handling in p(oop)stack

The mod decorates Claude Code. It must never break it, and it must never lie.

## Two lanes, chosen by who owns the failing value

1. **Ours alone** (the mod's own data and invariants: its vocabulary, its state shape, its own
   tree): a broken invariant throws inside the hook. The engine catches it, skips that hook alone
   and names the plugin in the transcript. That is the loud failure.
2. **Shared with the world** (anything `$` returns: `$.config.set`, `$.settings.read`,
   `$.store`, `$.audio.play`, the engine's events): validate it, and handle a failure visibly.
   `/poopstack off` that could not write its setting says so; it never claims to be off.

## What every hook does with the unexpected

- A hook that rewrites anything passes the event on unchanged (`next(e)`) when the input is not
  what it expects, and carries a `.catch` that does the same.
- An observer at a gating event (`tool.call`, `prompt.submit`, `command.run`,
  `session.receive`) calls `next(e)` exactly once, with the input unchanged, and returns the
  result unchanged. Nothing decorative is awaited before `next`.
- A `command.run` hook always has a name matcher: an unmatched one can answer another plugin's
  command.

## Never

- No success-shaped defaults: a catch never returns a plausible value (`null`, `[]`, `0`, `''`)
  in place of the failure.
- No empty or swallowing catch; no `@ts-ignore`; no `as any` or `as unknown as`; no suppression
  without its reason. `ast-grep-rules/` enforces these (`pnpm check:ast`).
- No joke that hides real information: the engine's status message, errors, refusals and the
  clock stay visible and true.
